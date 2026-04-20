/**
 * POST /api/projects/[projectId]/summary-cards/analysis/cv
 *
 * サマリカード単位で複数ハイパーパラメータパターンの時系列クロスバリデーション（平均 RMSE）を返す。
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { runSummaryCardCvPatterns, type SummaryCardPenaltyType } from '@/lib/analysis/summary-card-analysis'

const PenaltySchema = z.enum(['ridge', 'lasso', 'elastic_net', 'ols'])

const PatternSchema = z.object({
  penaltyType: PenaltySchema,
  lambda:      z.number().finite().nonnegative(),
  elasticAlpha: z.number().finite().min(0).max(1).optional().nullable(),
})

const BodySchema = z.object({
  treeId:       z.string().uuid(),
  parentNodeId: z.string().uuid(),
  timeUnit:     z.enum(['day', 'week', 'month']).default('day'),
  rangeStart:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rangeEnd:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kFolds:       z.number().int().min(2).max(10).default(5),
  patterns:     z.array(PatternSchema).min(1).max(200),
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
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { treeId, parentNodeId, timeUnit, rangeStart, rangeEnd, kFolds, patterns } = parsed.data
  if (rangeStart > rangeEnd) {
    return NextResponse.json({ success: false, error: 'rangeStart は rangeEnd 以下である必要があります' }, { status: 400 })
  }

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
  const normPatterns = patterns.map(p => ({
    penaltyType: p.penaltyType as SummaryCardPenaltyType,
    lambda:      p.penaltyType === 'ols' ? 0 : p.lambda,
    elasticAlpha:
      p.penaltyType === 'elastic_net'
        ? (p.elasticAlpha ?? 0.5)
        : null,
  }))

  try {
    const { patterns: outPatterns, warnings } = await runSummaryCardCvPatterns({
      supabase: supabase as unknown as import('@/lib/summary/fetch-metrics').SupabaseServerClient,
      projectId,
      yColKey,
      xColKeys,
      startDate: rangeStart,
      endDate: rangeEnd,
      timeUnit,
      patterns: normPatterns,
      kFolds,
      minObs,
    })
    return NextResponse.json({
      success: true,
      data: {
        yColKey,
        xColKeys,
        patterns: outPatterns,
        warnings,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('INSUFFICIENT_DATA')) {
      return NextResponse.json(
        { success: false, error: 'INSUFFICIENT_DATA', message: msg },
        { status: 422 },
      )
    }
    return NextResponse.json({ success: false, error: 'CV_FAILED', message: msg }, { status: 500 })
  }
}
