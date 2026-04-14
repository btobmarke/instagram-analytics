/**
 * GET /api/projects/[projectId]/preset-analysis?treeId=xxx&startDate=&endDate=&timeUnit=
 *
 * 指定ツリーのプリセット一覧を「ボトムアップ順」で返す。
 * 各プリセットに最新の分析結果（kpi_weight_versions）と is_stale も含める。
 *
 * Response:
 *   {
 *     presets: PresetWithAnalysis[]   // ボトムアップ順
 *     bottomUpOrder: string[]         // preset_id の順序
 *     allAnalyzed: boolean            // 全プリセットが分析済みか
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const treeId = searchParams.get('treeId')
  if (!treeId) {
    return NextResponse.json({ success: false, error: 'treeId は必須です' }, { status: 400 })
  }

  // ── 1. プリセット一覧取得 ────────────────────────────────────────────────────
  const { data: presets, error: presetsErr } = await supabase
    .from('project_analysis_presets')
    .select('*')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)
    .order('created_at', { ascending: true })

  if (presetsErr) return NextResponse.json({ success: false, error: presetsErr.message }, { status: 500 })

  if (!presets || presets.length === 0) {
    return NextResponse.json({
      success: true,
      data: { presets: [], bottomUpOrder: [], allAnalyzed: false },
    })
  }

  // ── 2. 各プリセットの最新 weight_version を取得 ──────────────────────────────
  const presetIds = presets.map(p => p.id as string)
  const { data: weights } = await supabase
    .from('kpi_weight_versions')
    .select('*')
    .in('preset_id', presetIds)
    .order('version_no', { ascending: false })

  // preset_id → 最新バージョンのマップ
  const latestWeightMap = new Map<string, Record<string, unknown>>()
  for (const w of weights ?? []) {
    const pid = w.preset_id as string
    if (!latestWeightMap.has(pid)) latestWeightMap.set(pid, w as Record<string, unknown>)
  }

  // ── 3. ツリーノードを取得してボトムアップ順を計算 ─────────────────────────────
  const { data: nodes } = await supabase
    .from('project_kpi_tree_nodes')
    .select('id, parent_id, metric_ref, service_id')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)

  // ノードの深さを計算（葉 = 最大深さ、ルート = 0）
  function getDepth(nodeId: string, allNodes: { id: string; parent_id: string | null }[]): number {
    const node = allNodes.find(n => n.id === nodeId)
    if (!node || !node.parent_id) return 0
    return 1 + getDepth(node.parent_id, allNodes)
  }

  const allNodes = (nodes ?? []) as { id: string; parent_id: string | null; metric_ref: string | null; service_id: string | null }[]

  // target_metric_ref からノードを検索してその深さを取得
  function resolveDepthByColKey(targetRef: string): number {
    const sep = targetRef.indexOf('::')
    const metricRef = sep >= 0 ? targetRef.slice(sep + 2) : targetRef
    const serviceId = sep >= 0 ? targetRef.slice(0, sep) : null

    const node = allNodes.find(n =>
      n.metric_ref === metricRef &&
      (serviceId ? n.service_id === serviceId : true)
    )
    if (!node) return 0
    return getDepth(node.id, allNodes)
  }

  // ── 4. ボトムアップ順でソート（深い = 下層 = 先に分析する）─────────────────
  const presetsWithMeta = presets.map(p => ({
    ...p,
    latestWeight: latestWeightMap.get(p.id as string) ?? null,
    depth: resolveDepthByColKey(p.target_metric_ref as string),
  }))

  // 深さ降順（深い方が先）でソート
  presetsWithMeta.sort((a, b) => b.depth - a.depth)

  const bottomUpOrder = presetsWithMeta.map(p => p.id as string)
  const allAnalyzed = presetsWithMeta.every(p => p.latestWeight !== null && !p.is_stale)

  return NextResponse.json({
    success: true,
    data: {
      presets:      presetsWithMeta,
      bottomUpOrder,
      allAnalyzed,
    },
  })
}
