'use client'

import { use, useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import type { UnifiedTableRow, ProjectSummaryTemplate, TimeUnit } from '../../../_lib/types'
import { SERVICE_TYPE_INFO, TIME_UNIT_LABELS } from '../../../_lib/types'
import { getTemplate } from '../../../_lib/store'
import { generateJstDayPeriodLabels, generateCustomRangePeriod } from '@/lib/summary/jst-periods'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 数値フォーマット ───────────────────────────────────────────────────────────

function formatCell(value: number | null | undefined, metricRef: string): string {
  if (value == null) return '—'
  if (metricRef.includes('rate') || metricRef.includes('ctr')) {
    return `${(value * 100).toFixed(1)}%`
  }
  if (metricRef.includes('seconds')) {
    const mins = Math.floor(value / 60)
    const secs = Math.round(value % 60)
    return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`
  }
  if (metricRef.includes('cost_micros') || metricRef.includes('cpc_micros')) {
    return `¥${Math.round(value / 1_000_000).toLocaleString()}`
  }
  if (Number.isInteger(value)) return value.toLocaleString('ja-JP')
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })
}

// ── 前比較ヘルパー ────────────────────────────────────────────────────────────

function calcChange(current: number | null, prev: number | null): number | null {
  if (current == null || prev == null || prev === 0) return null
  return ((current - prev) / Math.abs(prev)) * 100
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-gray-300">—</span>
  const isPos = pct >= 0
  return (
    <span className={`text-[9px] font-medium ${isPos ? 'text-emerald-600' : 'text-red-500'}`}>
      {isPos ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

// ── 時間軸ヘッダ生成 ──────────────────────────────────────────────────────────

function generateTimeHeaders(unit: TimeUnit, count: number, rangeStart?: string | null, rangeEnd?: string | null): string[] {
  if (unit === 'custom_range') {
    if (rangeStart && rangeEnd) return [generateCustomRangePeriod(rangeStart, rangeEnd).label]
    return ['（期間未設定）']
  }
  if (unit === 'day') return generateJstDayPeriodLabels(count)
  const headers: string[] = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    switch (unit) {
      case 'hour':  d.setHours(d.getHours() - i);   headers.push(`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`); break
      case 'week': { const s = new Date(d); s.setDate(d.getDate()-i*7); headers.push(`${s.getMonth()+1}/${s.getDate()}週`); break }
      case 'month': d.setMonth(d.getMonth() - i);   headers.push(`${d.getFullYear()}/${d.getMonth()+1}`); break
    }
  }
  return headers
}

// ── カスタム指標フォーミュラ評価（個別 view と同じロジック） ──────────────────

interface FormulaStep { operator: '+' | '-' | '*' | '/'; operandId: string }
interface FormulaNode {
  baseOperandId: string
  steps: FormulaStep[]
  thresholdMode?: 'none' | 'gte' | 'lte'
  thresholdValue?: number | null
}

function evalFormula(
  formula: FormulaNode,
  rawData: Record<string, Record<string, number | null>>,
  label: string,
): number | null {
  let sawNumeric = false
  const get = (id: string): number | null => {
    const v = rawData[id]?.[label]
    if (v != null) sawNumeric = true
    return v ?? null
  }
  const pm = (v: number | null) => v ?? 0
  let result: number | null = get(formula.baseOperandId)
  for (const step of formula.steps) {
    const op = get(step.operandId)
    switch (step.operator) {
      case '+': result = pm(result) + pm(op); break
      case '-': result = pm(result) - pm(op); break
      case '*': if (result == null || op == null) return null; result *= op; break
      case '/': if (result == null || op == null || op === 0) return null; result /= op; break
    }
  }
  if (!sawNumeric) return null
  const rounded = Math.round((result ?? 0) * 100) / 100
  const tm = formula.thresholdMode ?? 'none'
  const tv = formula.thresholdValue
  if (tm === 'gte' && tv != null && rounded < tv) return null
  if (tm === 'lte' && tv != null && rounded > tv) return null
  return rounded
}

// ── データ API パラメータ ─────────────────────────────────────────────────────

function buildDataUrl(projectId: string, tmpl: ProjectSummaryTemplate): string {
  const params = new URLSearchParams({
    timeUnit: tmpl.timeUnit,
    count:    String(tmpl.count),
  })
  if (tmpl.timeUnit === 'custom_range' && tmpl.rangeStart && tmpl.rangeEnd) {
    params.set('rangeStart', tmpl.rangeStart)
    params.set('rangeEnd',   tmpl.rangeEnd)
  }
  return `/api/projects/${projectId}/unified-summary?${params}`
}

// ── カスタム指標ライブラリ型 ──────────────────────────────────────────────────

interface LibraryMetric {
  id:      string
  name:    string
  formula: FormulaNode
}

// ── メインページ ─────────────────────────────────────────────────────────────

export default function UnifiedTemplateViewPage({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>
}) {
  const { projectId, templateId } = use(params)

  // ── テンプレートロード ─────────────────────────────────────────
  const [tmpl, setTmpl] = useState<ProjectSummaryTemplate | null>(null)
  useEffect(() => {
    getTemplate(projectId, templateId).then(setTmpl).catch(console.error)
  }, [projectId, templateId])

  // ── カスタム指標ライブラリ（サービスごと）─────────────────────
  const [customMetricsByService, setCustomMetricsByService] = useState<Record<string, LibraryMetric[]>>({})
  useEffect(() => {
    if (!tmpl || tmpl.rows.length === 0) return
    const uniqueServiceIds = [...new Set(tmpl.rows.map(r => r.serviceId))]
    Promise.all(
      uniqueServiceIds.map(sid =>
        fetch(`/api/services/${sid}/custom-metrics`)
          .then(r => r.json())
          .then((j: { data?: LibraryMetric[] }) => ({ serviceId: sid, data: j.data ?? [] }))
      ),
    ).then(results => {
      const map: Record<string, LibraryMetric[]> = {}
      for (const { serviceId, data } of results) map[serviceId] = data
      setCustomMetricsByService(map)
    }).catch(console.error)
  }, [tmpl])

  // serviceId → metricId → FormulaNode
  const customMetricMap = useMemo(() => {
    const map = new Map<string, Map<string, FormulaNode>>()
    for (const [serviceId, metrics] of Object.entries(customMetricsByService)) {
      const byId = new Map<string, FormulaNode>()
      for (const m of metrics) byId.set(m.id, m.formula)
      map.set(serviceId, byId)
    }
    return map
  }, [customMetricsByService])

  // ── プロジェクト名 ─────────────────────────────────────────────
  const { data: projectData } = useSWR<{ success: boolean; data: { project_name: string } }>(
    `/api/projects/${projectId}`,
    fetcher,
  )
  const projectName = projectData?.data?.project_name ?? ''

  // ── サマリーデータ取得 ─────────────────────────────────────────
  interface UnifiedService {
    id: string
    name: string
    serviceType: string
    metrics: Record<string, { label: string; category: string; values: Record<string, number | null> }>
  }

  const dataUrl = tmpl ? buildDataUrl(projectId, tmpl) : null
  const { data: summaryData, isLoading } = useSWR<{ success: boolean; data: { periods: string[]; services: UnifiedService[] } }>(
    dataUrl,
    fetcher,
  )

  const timeHeaders = useMemo(
    () => tmpl ? generateTimeHeaders(tmpl.timeUnit, tmpl.count, tmpl.rangeStart, tmpl.rangeEnd) : [],
    [tmpl],
  )

  const apiServices = summaryData?.data?.services ?? []

  // serviceId → metrics data マップ
  const serviceDataMap = useMemo(() => {
    const map = new Map<string, Record<string, Record<string, number | null>>>()
    for (const svc of apiServices) {
      const metricMap: Record<string, Record<string, number | null>> = {}
      for (const [ref, m] of Object.entries(svc.metrics)) {
        metricMap[ref] = m.values
      }
      map.set(svc.id, metricMap)
    }
    return map
  }, [apiServices])

  // ── サービス別グループ（テーブル表示用） ──────────────────────
  const rowsByService = useMemo(() => {
    if (!tmpl) return []
    const serviceOrder: string[] = []
    const grouped: Record<string, UnifiedTableRow[]> = {}
    for (const row of tmpl.rows) {
      if (!grouped[row.serviceId]) {
        serviceOrder.push(row.serviceId)
        grouped[row.serviceId] = []
      }
      grouped[row.serviceId].push(row)
    }
    return serviceOrder.map(sid => ({
      serviceId:   sid,
      serviceType: grouped[sid][0].serviceType,
      rows:        grouped[sid],
    }))
  }, [tmpl])

  if (!tmpl) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-sm text-gray-500">読み込み中...</div>
      </div>
    )
  }

  const hasRows = tmpl.rows.length > 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── ヘッダー ────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center gap-3">
          <Link
            href={`/projects/${projectId}/unified-summary`}
            className="text-gray-400 hover:text-gray-600 text-sm transition"
          >
            ←
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">{tmpl.name}</h1>
            <p className="text-xs text-gray-400">
              {projectName} / 横断サマリー ／ {TIME_UNIT_LABELS[tmpl.timeUnit]}
              {tmpl.timeUnit !== 'custom_range' ? ` × ${tmpl.count}` : ''}
            </p>
          </div>
          <Link
            href={`/projects/${projectId}/unified-summary/templates/${templateId}`}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            編集
          </Link>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-6">
        {/* ── ローディング ─────────────────────────────────────── */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm text-gray-400">データ取得中...</div>
          </div>
        )}

        {/* ── テーブル ─────────────────────────────────────────── */}
        {!isLoading && hasRows && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-gray-500 font-medium whitespace-nowrap sticky left-0 bg-gray-50 z-10 w-24">
                      サービス
                    </th>
                    <th className="px-4 py-3 text-left text-gray-700 font-semibold min-w-[160px] sticky left-24 bg-gray-50 z-10">
                      指標
                    </th>
                    {timeHeaders.map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-3 text-center font-medium whitespace-nowrap ${
                          i === timeHeaders.length - 1 ? 'text-gray-900 bg-blue-50' : 'text-gray-500'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsByService.map(({ serviceId, serviceType, rows: svcRows }, grpIdx) => {
                    const theme = SERVICE_TYPE_INFO[serviceType]
                    const metricDataMap = serviceDataMap.get(serviceId) ?? {}
                    const svcCustomMap  = customMetricMap.get(serviceId)

                    return svcRows.map((row, rowIdx) => {
                      // カスタム指標かどうか判定
                      const formula = svcCustomMap?.get(row.metricRef) ?? null
                      // 標準指標の場合は値マップを直接使う
                      const values = !formula ? (metricDataMap[row.metricRef] ?? {}) : {}

                      // 期間ラベル → 値 を解決するヘルパー
                      const getV = (label: string): number | null =>
                        formula ? evalFormula(formula, metricDataMap, label) : (values[label] ?? null)

                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-gray-100 hover:bg-gray-50/70 transition
                            ${rowIdx === 0 && grpIdx > 0 ? 'border-t-2 border-t-gray-200' : ''}`}
                        >
                          {/* サービスバッジ（グループ最初の行のみ表示） */}
                          {rowIdx === 0 ? (
                            <td
                              rowSpan={svcRows.length}
                              className="px-3 py-2 align-top sticky left-0 bg-white z-[5] border-r border-gray-100"
                            >
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold ${theme?.badgeClass ?? 'bg-gray-100 text-gray-600'}`}>
                                {theme?.icon} {theme?.abbr ?? serviceType}
                              </span>
                            </td>
                          ) : null}

                          {/* 指標ラベル（カスタム指標は ✦ マーク付き） */}
                          <td className="px-4 py-2 text-gray-700 font-medium whitespace-nowrap sticky left-24 bg-white z-[5] border-r border-gray-100">
                            {formula && (
                              <span className="mr-1 text-amber-500 text-[10px]">✦</span>
                            )}
                            {row.label}
                          </td>

                          {/* 各期間のデータ */}
                          {timeHeaders.map((h, colIdx) => {
                            const v     = getV(h)
                            const prevV = colIdx > 0 ? getV(timeHeaders[colIdx - 1]) : null
                            const isLast = colIdx === timeHeaders.length - 1
                            return (
                              <td
                                key={h}
                                className={`px-3 py-2 text-center whitespace-nowrap ${isLast ? 'bg-blue-50/50 font-semibold text-gray-900' : 'text-gray-600'}`}
                              >
                                <div>{formatCell(v, row.metricRef)}</div>
                                {isLast && tmpl.timeUnit === 'day' && (
                                  <ChangeBadge pct={calcChange(v, prevV)} />
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })
                  })}
                </tbody>
              </table>
            </div>

            {/* フッター情報 */}
            <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400 flex items-center gap-4">
              <span>{tmpl.rows.length} 指標</span>
              <span>最終列：{timeHeaders[timeHeaders.length - 1]}</span>
              {tmpl.timeUnit === 'day' && (
                <span className="ml-auto">最右列に前日比（▲▼）を表示</span>
              )}
            </div>
          </div>
        )}

        {/* ── 行が空のとき ─────────────────────────────────────── */}
        {!isLoading && !hasRows && (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
            <p className="text-sm text-gray-400 mb-4">このテンプレートにはまだ指標が追加されていません</p>
            <Link
              href={`/projects/${projectId}/unified-summary/templates/${templateId}`}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition"
            >
              ✏️ 指標を追加する
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
