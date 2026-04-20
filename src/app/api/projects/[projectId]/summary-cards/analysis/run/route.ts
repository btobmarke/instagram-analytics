/**
 * POST /api/projects/[projectId]/summary-cards/analysis/run
 *
 * サマリカード（親ノード）単位で 1 つ以上の重回帰モデルを実行し、結果を保存する。
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { runSummaryCardAnalysis, type SummaryCardPenaltyType } from '@/lib/analysis/summary-card-analysis'

const PenaltySchema = z.enum(['ridge', 'lasso', 'elastic_net', 'ols'])

const ModelSpecSchema = z.object({
  penaltyType: PenaltySchema,
  lambda:      z.number().finite().nonnegative(),
  elasticAlpha: z.number().finite().min(0).max(1).optional().nullable(),
  modelName:   z.string().max(120).optional().nullable(),
})

const BodySchema = z.object({
  treeId:        z.string().uuid(),
  parentNodeId:  z.string().uuid(),
  timeUnit:      z.enum(['day', 'week', 'month']).default('day'),
  rangeStart:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rangeEnd:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  models:        z.array(ModelSpecSchema).min(1).max(32).optional(),
  cvSummary:     z.unknown().optional().nullable(),
})

type NodeRow = {
  id: string
  parent_id: string | null
  sort_order: number
  label: string
  node_type: 'folder' | 'leaf'
  metric_ref: string | null
  service_id: string | null
}

function colKey(serviceId: string, metricRef: string) {
  return `${serviceId}::${metricRef}`
}

function sortNodes(a: NodeRow, b: NodeRow) {
  return (a.sort_order - b.sort_order) || a.label.localeCompare(b.label)
}

function collectLeafColKeysInOrder(rootId: string, childrenByParent: Map<string, NodeRow[]>): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    const kids = [...(childrenByParent.get(id) ?? [])].sort(sortNodes)
    for (const k of kids) {
      if (k.node_type === 'leaf') {
        if (k.service_id && k.metric_ref) out.push(colKey(k.service_id, k.metric_ref))
      } else {
        walk(k.id)
      }
    }
  }
  walk(rootId)
  return out
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })

  const { treeId, parentNodeId, timeUnit, rangeStart, rangeEnd, models, cvSummary } = parsed.data
  if (rangeStart > rangeEnd) {
    return NextResponse.json({ success: false, error: 'rangeStart は rangeEnd 以下である必要があります' }, { status: 400 })
  }

  const { data: existingSession, error: sessErr } = await supabase
    .from('summary_card_analysis_sessions')
    .select('*')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessErr) return NextResponse.json({ success: false, error: sessErr.message }, { status: 500 })

  if (existingSession) {
    const locked =
      existingSession.time_unit !== timeUnit ||
      String(existingSession.range_start).slice(0, 10) !== rangeStart ||
      String(existingSession.range_end).slice(0, 10) !== rangeEnd
    if (locked) {
      return NextResponse.json(
        {
          success: false,
          error: 'LOCKED',
          data: {
            session: existingSession,
            message: '既に分析が開始されているため、集計粒度・期間は変更できません。',
          },
        },
        { status: 409 },
      )
    }
  }

  const session = existingSession ?? (await (async () => {
    const { data: created, error } = await supabase
      .from('summary_card_analysis_sessions')
      .insert({
        project_id: projectId,
        kpi_tree_id: treeId,
        time_unit: timeUnit,
        range_start: rangeStart,
        range_end: rangeEnd,
        status: 'locked',
      })
      .select('*')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'session create failed')
    return created
  })())

  const { data: nodes, error: nodeErr } = await supabase
    .from('project_kpi_tree_nodes')
    .select('id,parent_id,sort_order,label,node_type,metric_ref,service_id')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (nodeErr) return NextResponse.json({ success: false, error: nodeErr.message }, { status: 500 })

  const nodeList = (nodes ?? []) as NodeRow[]
  const parent = nodeList.find(n => n.id === parentNodeId)
  if (!parent) return NextResponse.json({ success: false, error: 'PARENT_NODE_NOT_FOUND' }, { status: 404 })

  if (!parent.service_id || !parent.metric_ref) {
    return NextResponse.json(
      { success: false, error: 'Y_NOT_SET', message: '親指標（Y）が未設定です' },
      { status: 422 },
    )
  }
  const yColKey = colKey(parent.service_id, parent.metric_ref)

  const childrenByParent = new Map<string, NodeRow[]>()
  for (const n of nodeList) {
    if (!n.parent_id) continue
    if (!childrenByParent.has(n.parent_id)) childrenByParent.set(n.parent_id, [])
    childrenByParent.get(n.parent_id)!.push(n)
  }
  const directChildren = [...(childrenByParent.get(parentNodeId) ?? [])].sort(sortNodes)
  const xAll = directChildren.flatMap(ch => {
    if (ch.node_type === 'leaf') {
      return (ch.service_id && ch.metric_ref) ? [colKey(ch.service_id, ch.metric_ref)] : []
    }
    return collectLeafColKeysInOrder(ch.id, childrenByParent)
  })
  const xUniq = [...new Set(xAll)].filter(x => x !== yColKey)
  const xColKeys = xUniq.slice(0, 20)

  if (xColKeys.length === 0) {
    return NextResponse.json(
      { success: false, error: 'X_EMPTY', message: '子指標（X）がありません' },
      { status: 422 },
    )
  }

  const minObs = 12
  const modelSpecs =
    models && models.length > 0
      ? models.map(m => ({
        penaltyType: m.penaltyType as SummaryCardPenaltyType,
        lambda:      m.penaltyType === 'ols' ? 0 : m.lambda,
        elasticAlpha:
          m.penaltyType === 'elastic_net'
            ? (m.elasticAlpha ?? 0.5)
            : null,
        modelName: m.modelName ?? null,
      }))
      : [{
        penaltyType: 'ridge' as const,
        lambda:      1,
        elasticAlpha: null,
        modelName:   null,
      }]

  const allWarnings: string[] = []
  const savedRows: unknown[] = []

  await supabase
    .from('summary_card_analysis_results')
    .delete()
    .eq('session_id', session.id)
    .eq('parent_node_id', parentNodeId)

  for (const spec of modelSpecs) {
    let analysis
    try {
      analysis = await runSummaryCardAnalysis({
        supabase: supabase as unknown as import('@/lib/summary/fetch-metrics').SupabaseServerClient,
        projectId,
        yColKey,
        xColKeys,
        startDate: rangeStart,
        endDate: rangeEnd,
        timeUnit,
        penaltyType: spec.penaltyType,
        lambda: spec.lambda,
        elasticAlpha: spec.elasticAlpha,
        minObs,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('INSUFFICIENT_DATA')) {
        return NextResponse.json(
          {
            success: false,
            error: 'INSUFFICIENT_DATA',
            message: `モデル ${spec.modelName ?? spec.penaltyType} でデータ不足: ${msg}`,
          },
          { status: 422 },
        )
      }
      if (msg === 'SINGULAR_MATRIX') {
        return NextResponse.json(
          {
            success: false,
            error: 'SINGULAR_MATRIX',
            message: `モデル ${spec.modelName ?? spec.penaltyType} で特異行列のため推定できませんでした`,
          },
          { status: 422 },
        )
      }
      return NextResponse.json({ success: false, error: 'ANALYSIS_FAILED', message: msg }, { status: 500 })
    }

    const { model, metrics, series, warnings } = analysis
    allWarnings.push(...warnings)

    const defaultName =
      spec.penaltyType === 'elastic_net'
        ? `EN λ=${spec.lambda} α=${spec.elasticAlpha ?? 0.5}`
        : spec.penaltyType === 'ols'
          ? 'OLS'
          : `${spec.penaltyType} λ=${spec.lambda}`

    const payload = {
      session_id: session.id,
      project_id: projectId,
      kpi_tree_id: treeId,
      parent_node_id: parentNodeId,
      time_unit: timeUnit,
      range_start: rangeStart,
      range_end: rangeEnd,
      y_col_key: yColKey,
      x_col_keys: xColKeys,
      ridge_lambda: spec.lambda,
      penalty_type: spec.penaltyType,
      elastic_alpha: spec.elasticAlpha,
      model_name: spec.modelName ?? defaultName,
      cv_summary_json: cvSummary ?? null,
      model_json: model,
      metrics_json: metrics,
      series_json: series,
    }

    const saved = await supabase.from('summary_card_analysis_results').insert(payload).select('*').single()
    if (saved.error || !saved.data) {
      return NextResponse.json(
        { success: false, error: saved.error?.message ?? 'SAVE_FAILED' },
        { status: 500 },
      )
    }
    savedRows.push(saved.data)
  }

  return NextResponse.json({
    success: true,
    data: {
      session,
      results: savedRows,
      warnings: allWarnings,
    },
  })
}
