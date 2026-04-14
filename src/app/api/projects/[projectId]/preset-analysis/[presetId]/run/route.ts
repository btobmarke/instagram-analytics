/**
 * POST /api/projects/[projectId]/preset-analysis/[presetId]/run
 *
 * 指定プリセットに対して Ridge/OLS 回帰を実行し、結果を kpi_weight_versions に保存する。
 * 成功時はプリセットの is_stale を false にリセットする。
 *
 * Body:
 *   {
 *     startDate:    string           // YYYY-MM-DD
 *     endDate:      string           // YYYY-MM-DD
 *     timeUnit?:    'day'|'week'|'month'  // default: 'day'
 *     ridgeLambda?: number           // Ridge 正則化パラメータ (0=OLS, default: 0)
 *     versionName?: string           // 保存バージョン名（省略時は自動生成）
 *   }
 *
 * Response:
 *   { success: true, data: { weightVersion, regression, warnings } }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { runRegressionForPreset, saveWeightVersion } from '@/lib/analysis/regression'

const BodySchema = z.object({
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeUnit:    z.enum(['day', 'week', 'month']).default('day'),
  ridgeLambda: z.number().min(0).max(1000).default(0),
  versionName: z.string().optional(),
})

type RouteParams = { params: Promise<{ projectId: string; presetId: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { projectId, presetId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { startDate, endDate, timeUnit, ridgeLambda, versionName } = parsed.data

  if (startDate > endDate) {
    return NextResponse.json(
      { success: false, error: 'startDate は endDate 以前にしてください' },
      { status: 400 },
    )
  }

  // ── 1. プリセット取得 ────────────────────────────────────────────────────────
  const { data: preset, error: presetErr } = await supabase
    .from('project_analysis_presets')
    .select('id, target_metric_ref, feature_metric_refs, project_id')
    .eq('id', presetId)
    .eq('project_id', projectId)
    .single()

  if (presetErr || !preset) {
    return NextResponse.json({ success: false, error: 'プリセットが見つかりません' }, { status: 404 })
  }

  const targetMetricRef   = preset.target_metric_ref as string
  const featureMetricRefs = preset.feature_metric_refs as string[]

  if (!targetMetricRef || !featureMetricRefs || featureMetricRefs.length === 0) {
    return NextResponse.json(
      { success: false, error: 'プリセットに target_metric_ref または feature_metric_refs が設定されていません' },
      { status: 422 },
    )
  }

  // ── 2. 回帰実行 ──────────────────────────────────────────────────────────────
  const { result, warnings } = await runRegressionForPreset(
    supabase,
    projectId,
    targetMetricRef,
    featureMetricRefs,
    startDate,
    endDate,
    timeUnit,
    ridgeLambda,
  )

  if (!result) {
    return NextResponse.json({
      success: false,
      error: '回帰分析を実行できませんでした（有効観測数不足、または特異行列）。',
      data: { warnings },
    }, { status: 422 })
  }

  // ── 3. 結果保存 ──────────────────────────────────────────────────────────────
  const { saved, error: saveError } = await saveWeightVersion(
    supabase,
    projectId,
    presetId,
    result,
    startDate,
    endDate,
    timeUnit,
    versionName,
  )

  if (saveError || !saved) {
    return NextResponse.json(
      { success: false, error: `結果の保存に失敗しました: ${saveError}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    data: {
      weightVersion: saved,
      regression:    result,
      warnings,
    },
  })
}
