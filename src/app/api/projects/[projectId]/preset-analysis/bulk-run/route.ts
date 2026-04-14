/**
 * POST /api/projects/[projectId]/preset-analysis/bulk-run
 *
 * 指定ツリーの全プリセットをボトムアップ順（深さ降順）で一括分析し、
 * 各プリセットの結果を kpi_weight_versions に保存する。
 *
 * 依存関係チェック: 上位プリセット（Y が別プリセットの X になっている場合）を先に分析する。
 * エラーが出たプリセットはスキップして次に進む。
 *
 * Body:
 *   {
 *     treeId:       string           // 対象ツリー ID（必須）
 *     startDate:    string           // YYYY-MM-DD
 *     endDate:      string           // YYYY-MM-DD
 *     timeUnit?:    'day'|'week'|'month'  // default: 'day'
 *     ridgeLambda?: number           // Ridge 正則化パラメータ (default: 0)
 *     versionName?: string           // バージョン名プレフィックス（省略時は自動生成）
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       total:    number
 *       succeeded: number
 *       failed:   number
 *       results:  { presetId, presetName, status, r2?, error?, warnings }[]
 *     }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { runRegressionForPreset, saveWeightVersion } from '@/lib/analysis/regression'

const BodySchema = z.object({
  treeId:      z.string().uuid(),
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeUnit:    z.enum(['day', 'week', 'month']).default('day'),
  ridgeLambda: z.number().min(0).max(1000).default(0),
  versionName: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { treeId, startDate, endDate, timeUnit, ridgeLambda, versionName } = parsed.data

  if (startDate > endDate) {
    return NextResponse.json(
      { success: false, error: 'startDate は endDate 以前にしてください' },
      { status: 400 },
    )
  }

  // ── 1. プリセット一覧取得 ─────────────────────────────────────────────────────
  const { data: presets, error: presetsErr } = await supabase
    .from('project_analysis_presets')
    .select('id, name, target_metric_ref, feature_metric_refs')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)

  if (presetsErr) {
    return NextResponse.json({ success: false, error: presetsErr.message }, { status: 500 })
  }

  if (!presets || presets.length === 0) {
    return NextResponse.json({
      success: true,
      data: { total: 0, succeeded: 0, failed: 0, results: [] },
    })
  }

  // ── 2. ツリーノードを取得してボトムアップ順を計算 ─────────────────────────────
  const { data: nodes } = await supabase
    .from('project_kpi_tree_nodes')
    .select('id, parent_id, metric_ref, service_id')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)

  const allNodes = (nodes ?? []) as {
    id: string
    parent_id: string | null
    metric_ref: string | null
    service_id: string | null
  }[]

  function getDepth(nodeId: string): number {
    const node = allNodes.find(n => n.id === nodeId)
    if (!node || !node.parent_id) return 0
    return 1 + getDepth(node.parent_id)
  }

  function resolveDepthByColKey(targetRef: string): number {
    const sep = targetRef.indexOf('::')
    const metricRef = sep >= 0 ? targetRef.slice(sep + 2) : targetRef
    const serviceId = sep >= 0 ? targetRef.slice(0, sep) : null
    const node = allNodes.find(n =>
      n.metric_ref === metricRef &&
      (serviceId ? n.service_id === serviceId : true)
    )
    if (!node) return 0
    return getDepth(node.id)
  }

  // ── 3. プリセットを深さ降順でソート（ボトムアップ順）─────────────────────────
  const presetsWithDepth = presets.map(p => ({
    ...p,
    depth: resolveDepthByColKey(p.target_metric_ref as string),
  }))
  presetsWithDepth.sort((a, b) => b.depth - a.depth)

  // ── 4. 順番に実行 ────────────────────────────────────────────────────────────
  type RunResult = {
    presetId:   string
    presetName: string
    status:     'success' | 'failed' | 'skipped'
    r2?:        number
    n?:         number
    error?:     string
    warnings:   string[]
  }

  const results: RunResult[] = []
  let succeeded = 0
  let failed    = 0

  for (const preset of presetsWithDepth) {
    const presetId   = preset.id as string
    const presetName = preset.name as string
    const targetRef  = preset.target_metric_ref as string
    const featureRefs = preset.feature_metric_refs as string[]

    if (!targetRef || !featureRefs || featureRefs.length === 0) {
      results.push({
        presetId,
        presetName,
        status: 'skipped',
        error:  'target_metric_ref または feature_metric_refs が未設定です',
        warnings: [],
      })
      failed++
      continue
    }

    try {
      const { result, warnings } = await runRegressionForPreset(
        supabase,
        projectId,
        targetRef,
        featureRefs,
        startDate,
        endDate,
        timeUnit,
        ridgeLambda,
      )

      if (!result) {
        results.push({
          presetId,
          presetName,
          status:   'failed',
          error:    '回帰分析を実行できませんでした（有効観測数不足、または特異行列）',
          warnings,
        })
        failed++
        continue
      }

      const name = versionName
        ? `${versionName} - ${presetName}`
        : undefined

      const { saved, error: saveError } = await saveWeightVersion(
        supabase,
        projectId,
        presetId,
        result,
        startDate,
        endDate,
        timeUnit,
        name,
      )

      if (saveError || !saved) {
        results.push({
          presetId,
          presetName,
          status:   'failed',
          error:    `保存エラー: ${saveError ?? '不明なエラー'}`,
          warnings,
        })
        failed++
        continue
      }

      results.push({
        presetId,
        presetName,
        status:   'success',
        r2:       result.r2,
        n:        result.n,
        warnings,
      })
      succeeded++

    } catch (err) {
      console.error(`[bulk-run] presetId=${presetId} error:`, err)
      results.push({
        presetId,
        presetName,
        status:   'failed',
        error:    '予期しないエラーが発生しました',
        warnings: [],
      })
      failed++
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      total:     presetsWithDepth.length,
      succeeded,
      failed,
      results,
    },
  })
}
