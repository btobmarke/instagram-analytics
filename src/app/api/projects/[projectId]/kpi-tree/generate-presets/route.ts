/**
 * POST /api/projects/[projectId]/kpi-tree/generate-presets
 *
 * KPI ツリーの構造を解析し、親ノード(Y) → 子ノード(X) の組み合わせで
 * 分析プリセットを自動生成・保存する。
 *
 * 既存プリセットとの重複（同じ target_metric_ref）は UPSERT で上書き。
 *
 * Response: { success: true, data: { created: number; updated: number; presets: Preset[] } }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

interface TreeNode {
  id:        string
  parentId:  string | null
  label:     string
  metricRef: string | null
  serviceId: string | null
  sortOrder: number
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  // ── 1. ツリー全体を取得 ──────────────────────────────────────────────────────
  const { data: rawNodes, error: nodesErr } = await supabase
    .from('project_kpi_tree_nodes')
    .select('id, parent_id, label, metric_ref, service_id, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (nodesErr) {
    return NextResponse.json({ success: false, error: nodesErr.message }, { status: 500 })
  }

  const nodes: TreeNode[] = (rawNodes ?? []).map(n => ({
    id:        n.id as string,
    parentId:  n.parent_id as string | null,
    label:     n.label as string,
    metricRef: n.metric_ref as string | null,
    serviceId: n.service_id as string | null,
    sortOrder: n.sort_order as number,
  }))

  if (nodes.length === 0) {
    return NextResponse.json({
      success: true,
      data: { created: 0, updated: 0, presets: [] },
    })
  }

  // ── 2. 親ノードを特定（子を持つノード）────────────────────────────────────────
  const childParentIds = new Set(nodes.filter(n => n.parentId).map(n => n.parentId!))

  // colKey を組み立て: serviceId が設定されていれば "{serviceId}::{metricRef}"、なければ "{metricRef}"
  // metricRef が空文字の場合も null 扱いにして除外する
  const toColKey = (node: TreeNode): string | null => {
    if (!node.metricRef || node.metricRef.trim() === '') return null
    if (node.serviceId) return `${node.serviceId}::${node.metricRef.trim()}`
    return node.metricRef.trim()
  }

  // ── 3. 親ノードごとにプリセット候補を組み立て ─────────────────────────────────
  const presetsToUpsert: {
    name:               string
    targetMetricRef:    string
    featureMetricRefs:  string[]
  }[] = []

  for (const parentNode of nodes) {
    if (!childParentIds.has(parentNode.id)) continue  // 葉ノードはスキップ

    const parentColKey = toColKey(parentNode)
    if (!parentColKey) continue  // metric_ref 未設定の親はスキップ

    const children = nodes
      .filter(n => n.parentId === parentNode.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    const featureRefs = children
      .map(c => toColKey(c))
      .filter((k): k is string => k !== null)

    if (featureRefs.length === 0) continue

    presetsToUpsert.push({
      name:              `[自動] ${parentNode.label}`,
      targetMetricRef:   parentColKey,
      featureMetricRefs: featureRefs,
    })
  }

  if (presetsToUpsert.length === 0) {
    return NextResponse.json({
      success: true,
      data: { created: 0, updated: 0, presets: [], message: 'metric_ref が設定された親子関係が見つかりませんでした。各ノードに指標を設定してください。' },
    })
  }

  // ── 4. 既存プリセット取得（重複チェック用）────────────────────────────────────
  const { data: existingPresets } = await supabase
    .from('project_analysis_presets')
    .select('id, target_metric_ref')
    .eq('project_id', projectId)

  const existingMap = new Map(
    (existingPresets ?? []).map(p => [p.target_metric_ref as string, p.id as string])
  )

  let created = 0
  let updated = 0
  const resultPresets: object[] = []

  for (const preset of presetsToUpsert) {
    const existingId = existingMap.get(preset.targetMetricRef)

    if (existingId) {
      // UPDATE
      const { data, error } = await supabase
        .from('project_analysis_presets')
        .update({
          name:                preset.name,
          feature_metric_refs: preset.featureMetricRefs,
        })
        .eq('id', existingId)
        .select()
        .single()

      if (!error && data) {
        updated++
        resultPresets.push(data)
      }
    } else {
      // INSERT
      const { data, error } = await supabase
        .from('project_analysis_presets')
        .insert({
          project_id:          projectId,
          name:                preset.name,
          target_metric_ref:   preset.targetMetricRef,
          feature_metric_refs: preset.featureMetricRefs,
        })
        .select()
        .single()

      if (!error && data) {
        created++
        resultPresets.push(data)
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: { created, updated, presets: resultPresets },
  })
}
