'use client'

import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { SummaryCardRegressionModal } from './SummaryCardRegressionModal'

type TimeUnit = 'day' | 'week' | 'month'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type KpiTree = { id: string; name: string; created_at?: string }
type KpiNodeRow = {
  id: string
  project_id: string
  kpi_tree_id: string
  parent_id: string | null
  sort_order: number
  label: string
  node_type: 'folder' | 'leaf'
  metric_ref: string | null
  service_id: string | null
}

type UnifiedSummaryResponse = {
  success: boolean
  data?: {
    periods: string[]
    services: Array<{
      id: string
      name: string
      serviceType: string
      metrics: Record<string, { label: string; category: string; values: Record<string, number | null> }>
    }>
  }
  error?: unknown
}

type NodesResponse = { success: boolean; data: KpiNodeRow[]; error?: unknown }
type TreesResponse = { success: boolean; data: KpiTree[]; error?: unknown }

type SessionRow = {
  id: string
  project_id: string
  kpi_tree_id: string
  time_unit: TimeUnit
  range_start: string
  range_end: string
  status: 'locked' | 'completed' | 'cancelled'
}

type AnalysisResultRow = {
  id: string
  parent_node_id: string
  model_name?: string | null
  penalty_type?: string | null
  elastic_alpha?: number | null
  metrics_json: { r2: number; mae: number; rmse: number; mape: number | null; n: number }
  model_json: {
    type?: string
    interceptStd: number
    coefficientsStd: Array<{ colKey: string; coef: number }>
    ridgeLambda: number
  }
  series_json: Array<{ period: string; actual: number | null; predicted: number | null; residual: number | null }>
}

type StandardizeRow = {
  colKey: string
  label: string
  role: 'Y' | 'X'
  values: Record<string, number | null>
}

type StandardizePayload = {
  periods: string[]
  rows: StandardizeRow[]
}

type CardRow =
  | { kind: 'metric'; nodeId: string; label: string; serviceId: string; metricRef: string; depth: number; isY?: boolean }
  | { kind: 'group'; nodeId: string; label: string; depth: number; collapsedByDefault: boolean }

type Card = {
  parentNodeId: string
  title: string
  rows: CardRow[]
}

function colKeyOf(serviceId: string, metricRef: string) {
  return `${serviceId}::${metricRef}`
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, delta: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + delta)
  return x
}

function flattenLeafRows(
  node: KpiNodeRow,
  childrenByParent: Map<string, KpiNodeRow[]>,
  depth: number,
): CardRow[] {
  const nodeId = node.id
  const kids = childrenByParent.get(nodeId) ?? []

  if (node.node_type === 'leaf') {
    if (!node.service_id || !node.metric_ref) return []
    return [{
      kind: 'metric',
      nodeId,
      label: node.label,
      serviceId: node.service_id,
      metricRef: node.metric_ref,
      depth,
    }]
  }

  const leafCount = (() => {
    let count = 0
    const stack = [...kids]
    while (stack.length) {
      const cur = stack.pop()!
      const ck = childrenByParent.get(cur.id) ?? []
      if (cur.node_type === 'leaf') {
        if (cur.service_id && cur.metric_ref) count++
      } else {
        stack.push(...ck)
      }
    }
    return count
  })()

  const collapsedByDefault = leafCount >= 12

  const out: CardRow[] = [{
    kind: 'group',
    nodeId,
    label: node.label,
    depth,
    collapsedByDefault,
  }]
  for (const child of kids) {
    out.push(...flattenLeafRows(child, childrenByParent, depth + 1))
  }
  return out
}

function buildCards(nodes: KpiNodeRow[]): Card[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const childrenByParent = new Map<string, KpiNodeRow[]>()
  const roots: KpiNodeRow[] = []

  for (const n of nodes) {
    if (!n.parent_id) {
      roots.push(n)
      continue
    }
    if (!childrenByParent.has(n.parent_id)) childrenByParent.set(n.parent_id, [])
    childrenByParent.get(n.parent_id)!.push(n)
  }

  const sortKids = (list: KpiNodeRow[]) =>
    [...list].sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label))

  const visit = (n: KpiNodeRow, cards: Card[]) => {
    const kids = sortKids(childrenByParent.get(n.id) ?? [])
    const hasChildren = kids.length > 0

    if (hasChildren) {
      const rows: CardRow[] = []

      if (n.metric_ref && n.service_id) {
        rows.push({
          kind: 'metric',
          nodeId: n.id,
          label: n.label,
          serviceId: n.service_id,
          metricRef: n.metric_ref,
          depth: 0,
          isY: true,
        })
      }

      for (const child of kids) {
        rows.push(...flattenLeafRows(child, childrenByParent, 0))
      }

      cards.push({
        parentNodeId: n.id,
        title: n.label,
        rows,
      })
    }

    for (const child of kids) visit(child, cards)
  }

  const cards: Card[] = []
  for (const r of sortKids(roots)) visit(r, cards)

  void byId
  return cards
}

function formatValue(value: number | null | undefined): string {
  if (value == null) return '—'
  if (Number.isNaN(value)) return '—'
  return Number.isFinite(value) ? value.toLocaleString('ja-JP', { maximumFractionDigits: 4 }) : String(value)
}

export function SummaryCardsAnalysisClient({ projectId }: { projectId: string }) {
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('day')
  const [rangeEnd, setRangeEnd] = useState<string>(() => isoDate(new Date()))
  const [rangeStart, setRangeStart] = useState<string>(() => isoDate(addDays(new Date(), -13)))

  const { data: treesResp, isLoading: isTreesLoading } = useSWR<TreesResponse>(`/api/projects/${projectId}/kpi-trees`, fetcher)
  const trees = treesResp?.success ? treesResp.data : []

  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null)
  const effectiveTreeId = selectedTreeId ?? (trees?.[0]?.id ?? null)

  const sessionKey = effectiveTreeId
    ? `/api/projects/${projectId}/summary-cards/analysis/session?treeId=${effectiveTreeId}`
    : null
  const { data: sessionResp, mutate: mutateSession } = useSWR<{ success: boolean; data: SessionRow | null }>(
    sessionKey,
    fetcher,
  )
  const session = sessionResp?.success ? (sessionResp.data ?? null) : null
  const isLocked = Boolean(session)

  const { data: nodesResp, isLoading: isNodesLoading } = useSWR<NodesResponse>(
    effectiveTreeId ? `/api/projects/${projectId}/kpi-tree/nodes?treeId=${effectiveTreeId}` : null,
    fetcher,
  )
  const nodes = nodesResp?.success ? nodesResp.data : []

  const resultsKey = session
    ? `/api/projects/${projectId}/summary-cards/analysis?sessionId=${session.id}`
    : null
  const { data: resultsResp, mutate: mutateResults } = useSWR<{ success: boolean; data: AnalysisResultRow[] }>(
    resultsKey,
    fetcher,
  )
  const results = resultsResp?.success ? (resultsResp.data ?? []) : []

  const resultsByParent = useMemo(() => {
    const m = new Map<string, AnalysisResultRow[]>()
    for (const r of results) {
      const list = m.get(r.parent_node_id) ?? []
      list.push(r)
      m.set(r.parent_node_id, list)
    }
    return m
  }, [results])

  const unifiedUrl = useMemo(() => {
    const p = new URLSearchParams()
    const tu = session?.time_unit ?? timeUnit
    const rs = session ? String(session.range_start).slice(0, 10) : rangeStart
    const re = session ? String(session.range_end).slice(0, 10) : rangeEnd
    p.set('timeUnit', tu)
    p.set('rangeStart', rs)
    p.set('rangeEnd', re)
    return `/api/projects/${projectId}/unified-summary?${p.toString()}`
  }, [projectId, timeUnit, rangeStart, rangeEnd, session])

  const { data: unifiedResp, isLoading: isUnifiedLoading } = useSWR<UnifiedSummaryResponse>(
    effectiveTreeId ? unifiedUrl : null,
    fetcher,
  )

  const periods = unifiedResp?.success ? (unifiedResp.data?.periods ?? []) : []
  const services = unifiedResp?.success ? (unifiedResp.data?.services ?? []) : []

  const cards = useMemo(() => buildCards(nodes), [nodes])

  const [standardizedByParent, setStandardizedByParent] = useState<Record<string, StandardizePayload>>({})
  const [viewModeByParent, setViewModeByParent] = useState<Record<string, 'raw' | 'std'>>({})
  const [stdLoadingParent, setStdLoadingParent] = useState<string | null>(null)
  const [regressionModal, setRegressionModal] = useState<{
    parentNodeId: string
    cardTitle: string
  } | null>(null)

  const stdRowMap = useCallback((parentId: string) => {
    const pack = standardizedByParent[parentId]
    if (!pack) return new Map<string, StandardizeRow>()
    return new Map(pack.rows.map(r => [r.colKey, r]))
  }, [standardizedByParent])

  const metricValue = (serviceId: string, metricRef: string, periodLabel: string): number | null | undefined => {
    const svc = services.find(s => s.id === serviceId)
    const m = svc?.metrics?.[metricRef]
    return m?.values?.[periodLabel]
  }

  const stdValue = (parentId: string, serviceId: string, metricRef: string, periodLabel: string) => {
    const ck = colKeyOf(serviceId, metricRef)
    return stdRowMap(parentId).get(ck)?.values[periodLabel]
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">横断サマリ：分析（サマリカード）</h1>
          <p className="text-sm text-gray-500">KPIツリーからサマリカードを自動生成して表示します。</p>
        </div>
        <Link href={`/projects/${projectId}/unified-summary`} className="text-sm text-blue-600 hover:underline">
          ← 横断サマリへ戻る
        </Link>
      </div>

      {regressionModal && effectiveTreeId && (
        <SummaryCardRegressionModal
          open
          cardTitle={regressionModal.cardTitle}
          projectId={projectId}
          treeId={effectiveTreeId}
          parentNodeId={regressionModal.parentNodeId}
          timeUnit={session?.time_unit ?? timeUnit}
          rangeStart={session ? String(session.range_start).slice(0, 10) : rangeStart}
          rangeEnd={session ? String(session.range_end).slice(0, 10) : rangeEnd}
          onClose={() => setRegressionModal(null)}
          onCommitted={async () => {
            await mutateSession()
            await mutateResults()
          }}
        />
      )}

      <div className="rounded-xl border bg-white p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <div className="text-xs text-gray-500 mb-1">KPIツリー</div>
            <select
              className="w-full border rounded-md px-2 py-1.5 text-sm"
              value={effectiveTreeId ?? ''}
              onChange={e => setSelectedTreeId(e.target.value)}
              disabled={isTreesLoading || !treesResp}
            >
              {trees.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">集計粒度</div>
            <select
              className="w-full border rounded-md px-2 py-1.5 text-sm"
              value={session?.time_unit ?? timeUnit}
              onChange={e => setTimeUnit(e.target.value as TimeUnit)}
              disabled={isLocked}
            >
              <option value="day">日次</option>
              <option value="week">週次（月曜開始）</option>
              <option value="month">月次</option>
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">開始日</div>
            <input
              type="date"
              className="w-full border rounded-md px-2 py-1.5 text-sm"
              value={session ? String(session.range_start).slice(0, 10) : rangeStart}
              onChange={e => setRangeStart(e.target.value)}
              disabled={isLocked}
            />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">終了日</div>
            <input
              type="date"
              className="w-full border rounded-md px-2 py-1.5 text-sm"
              value={session ? String(session.range_end).slice(0, 10) : rangeEnd}
              onChange={e => setRangeEnd(e.target.value)}
              disabled={isLocked}
            />
          </div>
        </div>
        {isLocked && (
          <div className="mt-3 text-xs text-gray-500">
            分析結果が存在するため、集計粒度・期間は固定されています。
          </div>
        )}
        {!effectiveTreeId && (
          <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
            KPIツリーがありません。先にツリーを作成してください。
          </div>
        )}

        {effectiveTreeId && (treesResp && !treesResp.success) && (
          <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            KPIツリーの取得に失敗しました。
          </div>
        )}

        {effectiveTreeId && (nodesResp && !nodesResp.success) && (
          <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            KPIツリーノードの取得に失敗しました。
          </div>
        )}

        {effectiveTreeId && (unifiedResp && !unifiedResp.success) && (
          <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            サマリ値の取得に失敗しました（未ログイン/権限/DBなどを確認してください）。
          </div>
        )}
      </div>

      <div className="space-y-4">
        {(isNodesLoading || isUnifiedLoading) && effectiveTreeId && (
          <div className="flex items-center justify-center py-8">
            <div className="w-7 h-7 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        )}
        {cards.map(card => {
          const hasY = card.rows.some(r => r.kind === 'metric' && r.isY)
          const stdPack = standardizedByParent[card.parentNodeId]
          const viewMode = viewModeByParent[card.parentNodeId] ?? 'raw'
          const displayPeriods =
            viewMode === 'std' && stdPack?.periods?.length
              ? stdPack.periods
              : periods
          const modelResults = resultsByParent.get(card.parentNodeId) ?? []

          return (
            <div key={card.parentNodeId} className="rounded-xl border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b">
                <div className="font-medium">{card.title}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {!hasY && (
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      親指標（Y）が未設定です
                    </span>
                  )}
                  {stdPack && (
                    <div className="flex items-center gap-1 text-xs border rounded-md p-0.5 bg-gray-50">
                      <button
                        type="button"
                        className={`px-2 py-1 rounded ${viewMode === 'raw' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}
                        onClick={() => setViewModeByParent(m => ({ ...m, [card.parentNodeId]: 'raw' }))}
                      >
                        生データ
                      </button>
                      <button
                        type="button"
                        className={`px-2 py-1 rounded ${viewMode === 'std' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}
                        onClick={() => setViewModeByParent(m => ({ ...m, [card.parentNodeId]: 'std' }))}
                      >
                        標準化
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="text-sm px-3 py-1.5 rounded-md border bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!hasY || !effectiveTreeId || stdLoadingParent === card.parentNodeId}
                    onClick={async () => {
                      if (!effectiveTreeId) return
                      const tu = session?.time_unit ?? timeUnit
                      const rs = session ? String(session.range_start).slice(0, 10) : rangeStart
                      const re = session ? String(session.range_end).slice(0, 10) : rangeEnd
                      setStdLoadingParent(card.parentNodeId)
                      try {
                        const res = await fetch(`/api/projects/${projectId}/summary-cards/analysis/standardize`, {
                          method:  'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body:    JSON.stringify({
                            treeId: effectiveTreeId,
                            parentNodeId: card.parentNodeId,
                            timeUnit: tu,
                            rangeStart: rs,
                            rangeEnd: re,
                          }),
                        }).then(r => r.json())
                        if (!res.success) {
                          alert(res.message ?? res.error ?? '標準化に失敗しました')
                          return
                        }
                        setStandardizedByParent(prev => ({
                          ...prev,
                          [card.parentNodeId]: res.data as StandardizePayload,
                        }))
                        setViewModeByParent(m => ({ ...m, [card.parentNodeId]: 'std' }))
                      } finally {
                        setStdLoadingParent(null)
                      }
                    }}
                  >
                    {stdPack ? '標準化の再計算' : '標準化'}
                  </button>
                  <button
                    type="button"
                    className="text-sm px-3 py-1.5 rounded-md border bg-purple-50 text-purple-800 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!hasY || !stdPack}
                    onClick={() =>
                      setRegressionModal({ parentNodeId: card.parentNodeId, cardTitle: card.title })
                    }
                  >
                    分析
                  </button>
                </div>
              </div>
              <div className="p-3 overflow-x-auto">
                {displayPeriods.length === 0 ? (
                  <div className="text-sm text-gray-500 py-6 text-center">
                    期間ヘッダーが生成できませんでした（データ取得中、または権限/設定を確認してください）。
                  </div>
                ) : (
                <table className="min-w-[820px] w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="sticky left-0 z-20 bg-gray-50 px-2 py-2.5 text-center text-gray-400 font-medium w-8 border-r border-gray-100">
                        役
                      </th>
                      <th className="sticky left-8 z-20 bg-gray-50 px-4 py-2.5 text-left text-xs font-bold text-gray-600 min-w-[220px] border-r border-gray-200">
                        指標
                      </th>
                      {displayPeriods.map((p, i) => (
                        <th
                          key={p}
                          className={`px-3 py-2.5 text-center text-[11px] font-medium min-w-[72px] whitespace-nowrap
                            ${i === displayPeriods.length - 1 ? 'text-gray-900 bg-blue-50 font-semibold' : 'text-gray-500'}`}
                        >
                          {p}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {card.rows.slice(0, 50).map((row) => {
                      if (row.kind === 'group') {
                        return (
                          <tr key={`g-${row.nodeId}`} className="bg-gray-50 border-b border-gray-100">
                            <td className="sticky left-0 z-10 px-2 py-2.5 text-center border-r border-gray-100 bg-gray-50">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                                —
                              </span>
                            </td>
                            <td className="sticky left-8 z-10 px-4 py-2.5 text-left border-r border-gray-200 bg-gray-50 font-medium text-gray-700">
                              <span style={{ paddingLeft: row.depth * 12 }}>{row.label}</span>
                            </td>
                            {displayPeriods.map(p => <td key={p} className="px-3 py-2.5 text-center text-gray-300" />)}
                          </tr>
                        )
                      }
                      const useStd = viewMode === 'std' && stdPack
                      const rowValues = useStd
                        ? displayPeriods.map(p => stdValue(card.parentNodeId, row.serviceId, row.metricRef, p))
                        : displayPeriods.map(p => metricValue(row.serviceId, row.metricRef, p))
                      const lastVal = rowValues[rowValues.length - 1]
                      const prevVal = rowValues[rowValues.length - 2]
                      const changePct =
                        !useStd &&
                        lastVal != null && prevVal != null && prevVal !== 0
                          ? ((lastVal - prevVal) / Math.abs(prevVal)) * 100
                          : null

                      return (
                        <tr
                          key={`m-${row.nodeId}`}
                          className={`border-b border-gray-100 transition
                            ${row.isY ? 'bg-purple-50/60 hover:bg-purple-50' : 'bg-white hover:bg-blue-50/20'}`}
                        >
                          <td className={`sticky left-0 z-10 px-2 py-2.5 text-center border-r border-gray-100 ${row.isY ? 'bg-purple-50/60' : 'bg-white'}`}>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${row.isY ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                              {row.isY ? 'Y' : 'X'}
                            </span>
                          </td>
                          <td className={`sticky left-8 z-10 px-4 py-2.5 text-left border-r border-gray-200 font-medium ${row.isY ? 'bg-purple-50/60 text-purple-800' : 'bg-white text-gray-700'}`}>
                            <span style={{ paddingLeft: row.depth * 12 }} className="truncate block max-w-[240px]" title={row.label}>
                              {row.label}
                              {useStd && <span className="ml-1 text-[10px] text-gray-400">(Z)</span>}
                            </span>
                          </td>
                          {rowValues.map((v, i) => {
                            const isLast = i === rowValues.length - 1
                            return (
                              <td
                                key={i}
                                className={`px-3 py-2.5 text-center font-mono whitespace-nowrap tabular-nums
                                  ${isLast ? 'bg-blue-50/60 font-semibold text-gray-900' : ''}
                                  ${v == null ? 'text-gray-300' : row.isY ? 'text-purple-700' : 'text-gray-700'}`}
                              >
                                {isLast && changePct != null ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span>{formatValue(v)}</span>
                                    <span className={`text-[9px] font-normal ${changePct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                      {changePct >= 0 ? '▲' : '▼'}{Math.abs(changePct).toFixed(1)}%
                                    </span>
                                  </div>
                                ) : (
                                  formatValue(v)
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                )}
                {card.rows.length > 50 && (
                  <div className="mt-2 text-xs text-gray-500">
                    行数が多いため、現時点では先頭50行のみ表示しています（段階表示は次の調整で追加）。
                  </div>
                )}

                {modelResults.length > 0 && (
                  <div className="mt-4 space-y-3">
                    <div className="text-sm font-semibold text-gray-700">回帰モデル（{modelResults.length} 件・同一期間で比較可能）</div>
                    {modelResults.map((r) => {
                      const coeffs = r.model_json?.coefficientsStd ?? []
                      const sorted = [...coeffs].sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
                      const maxAbs = Math.max(1e-9, ...sorted.map(c => Math.abs(c.coef)))
                      const title =
                        r.model_name ??
                        `${r.penalty_type ?? r.model_json?.type ?? 'model'} λ=${r.model_json?.ridgeLambda ?? ''}`
                      return (
                        <div key={r.id} className="rounded-xl border border-gray-200 overflow-hidden">
                          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-gray-800">{title}</div>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-white border text-gray-600">
                              {r.penalty_type ?? r.model_json?.type ?? '—'}
                              {r.elastic_alpha != null ? ` α=${r.elastic_alpha}` : ''}
                            </span>
                            <span className="text-xs font-bold px-2.5 py-1 rounded-lg border bg-white text-gray-700">
                              R²={r.metrics_json.r2} / n={r.metrics_json.n}
                            </span>
                            <span className="text-xs text-gray-500">
                              MAE={r.metrics_json.mae} RMSE={r.metrics_json.rmse}{r.metrics_json.mape != null ? ` MAPE=${r.metrics_json.mape}%` : ''}
                            </span>
                          </div>
                          <div className="p-4 space-y-3">
                            <div>
                              <div className="text-xs font-medium text-gray-500 mb-1.5">影響度（|標準化係数|）</div>
                              <div className="space-y-2 max-h-40 overflow-y-auto">
                                {sorted.slice(0, 12).map((c) => (
                                  <div key={c.colKey} className="flex items-center gap-2">
                                    <div className="text-[11px] text-gray-600 w-64 truncate" title={c.colKey}>
                                      {c.colKey}
                                    </div>
                                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                      <div
                                        className={`${c.coef >= 0 ? 'bg-blue-400' : 'bg-red-400'} h-full`}
                                        style={{ width: `${(Math.abs(c.coef) / maxAbs) * 100}%` }}
                                      />
                                    </div>
                                    <div className={`text-[11px] font-mono w-20 text-right ${c.coef >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                                      {c.coef >= 0 ? '+' : ''}{c.coef}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {effectiveTreeId && cards.length === 0 && (
          <div className="text-sm text-gray-500">カード化できる親ノード（子を持つノード）がありません。</div>
        )}
      </div>
    </div>
  )
}
