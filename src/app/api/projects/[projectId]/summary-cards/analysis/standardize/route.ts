/**
 * POST /api/projects/[projectId]/summary-cards/analysis/standardize
 *
 * サマリカードの Y/X 系列を期間方向に Z 標準化した表を返す（DB には保存しない）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildWideTable } from '@/lib/analysis/regression'

const BodySchema = z.object({
  treeId:       z.string().uuid(),
  parentNodeId: z.string().uuid(),
  timeUnit:     z.enum(['day', 'week', 'month']).default('day'),
  rangeStart:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rangeEnd:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / (xs.length || 1)
}

function std(xs: number[], mu: number): number {
  const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length || 1)
  return Math.sqrt(v) || 1
}

function zStandardizeSeries(
  periods: string[],
  wideMap: Record<string, Record<string, number | null>>,
  colKeyStr: string,
): Record<string, number | null> {
  const vals: number[] = []
  for (const p of periods) {
    const v = wideMap[p]?.[colKeyStr]
    if (v != null) vals.push(v)
  }
  if (vals.length < 2) {
    return Object.fromEntries(periods.map(p => [p, null]))
  }
  const mu = mean(vals)
  const sd = std(vals, mu)
  const out: Record<string, number | null> = {}
  for (const p of periods) {
    const raw = wideMap[p]?.[colKeyStr]
    out[p] = raw == null ? null : (raw - mu) / sd
  }
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

  const { treeId, parentNodeId, timeUnit, rangeStart, rangeEnd } = parsed.data
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

  const allRefs = [yColKey, ...xColKeys]
  const { table: wideMap, warnings } = await buildWideTable(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    projectId,
    allRefs,
    rangeStart,
    rangeEnd,
    timeUnit,
  )

  const periods = Object.keys(wideMap).sort()

  const labelForColKey = (ck: string): string => {
    const sep = ck.indexOf('::')
    if (sep < 0) return ck
    const sid = ck.slice(0, sep)
    const ref = ck.slice(sep + 2)
    const hit = nodeList.find(
      n => n.node_type === 'leaf' && n.service_id === sid && n.metric_ref === ref,
    )
    return hit?.label ?? ck
  }

  const standardizedRows = [
    {
      colKey: yColKey,
      label: parent.label,
      role: 'Y' as const,
      values: zStandardizeSeries(periods, wideMap, yColKey),
    },
    ...xColKeys.map(ck => ({
      colKey: ck,
      label: labelForColKey(ck),
      role: 'X' as const,
      values: zStandardizeSeries(periods, wideMap, ck),
    })),
  ]

  return NextResponse.json({
    success: true,
    data: {
      periods,
      yColKey,
      xColKeys,
      rows: standardizedRows,
      warnings,
    },
  })
}
