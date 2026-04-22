'use client'

import { use, useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import type { UnifiedTableRow, ProjectSummaryTemplate, TimeUnit } from '../../../_lib/types'
import { SERVICE_TYPE_INFO, TIME_UNIT_LABELS } from '../../../_lib/types'
import { resolveIGLabel } from '../../../../services/[serviceId]/summary/_lib/catalog'
import { getTemplate } from '../../../_lib/store'
import { generateJstDayPeriodLabels, generateJstDayPeriods, generateCustomRangePeriod } from '@/lib/summary/jst-periods'
import type { FormulaNode } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { evalServiceSummaryFormula } from '@/lib/summary/eval-service-formula'
import { collectUnifiedTemplateFieldRefs } from '../../../_lib/collect-template-field-refs'

const fetcher = (url: string) => fetch(url).then(r => r.json())

async function unifiedSummaryQueryFetcher([url, body]: [string, Record<string, unknown>]) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json() as Promise<{
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
  }>
}

// ── 数値フォーマット ───────────────────────────────────────────────────────────

function formatCell(value: number | null | undefined, metricRef: string): string {
  if (value == null) return '—'
  if (metricRef.includes('.ctr')) {
    return `${(value * 100).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}%`
  }
  if (metricRef.includes('rate')) {
    return `${(value * 100).toFixed(1)}%`
  }
  if (metricRef.includes('seconds')) {
    const mins = Math.floor(value / 60)
    const secs = Math.round(value % 60)
    return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`
  }
  if (
    metricRef.includes('cost_micros') ||
    metricRef.includes('conversion_value_micros') ||
    metricRef.includes('cpc_micros')
  ) {
    return `¥${Math.round(value / 1_000_000).toLocaleString()}`
  }
  if (Number.isInteger(value)) return value.toLocaleString('ja-JP')
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })
}

// ── 外因変数（祝日・天気）────────────────────────────────────────────────────
interface ExternalDayData {
  is_holiday:       boolean | null
  holiday_name:     string | null
  temperature_max:  number | null
  temperature_min:  number | null
  precipitation_mm: number | null
  weather_code:     number | null
  weather_desc:     string | null
}
interface ExternalData {
  hasWeather: boolean
  dates: Record<string, ExternalDayData>
}

function weatherEmoji(code: number | null): string {
  if (code == null) return '—'
  if (code === 0)   return '☀️'
  if (code <= 3)    return '⛅'
  if (code <= 48)   return '🌫️'
  if (code <= 55)   return '🌦️'
  if (code <= 65)   return '🌧️'
  if (code <= 77)   return '❄️'
  if (code <= 82)   return '🌦️'
  return '⛈️'
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

const evalFormula = evalServiceSummaryFormula

// ── カスタム指標ライブラリ型 ──────────────────────────────────────────────────

interface LibraryMetric {
  id:      string
  name:    string
  formula: FormulaNode
}

// ── チャートカラーパレット ─────────────────────────────────────────────────────
const CHART_COLORS = [
  '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
]

// ── グラフモード: サービスごとに指標を折れ線グラフで表示 ──────────────────────

interface ServiceGroup {
  serviceId: string
  serviceType: string
  rows: UnifiedTableRow[]
}

function UnifiedChartView({
  rowsByService,
  serviceDataMap,
  customMetricMap,
  timeHeaders,
  formatCell,
  evalFormula: evalFn,
}: {
  rowsByService: ServiceGroup[]
  serviceDataMap: Map<string, Record<string, Record<string, number | null>>>
  customMetricMap: Map<string, Map<string, FormulaNode>>
  timeHeaders: string[]
  formatCell: (v: number | null, ref: string) => string
  evalFormula: (f: FormulaNode, d: Record<string, Record<string, number | null>>, label: string) => number | null
}) {
  return (
    <div className="space-y-6">
      {rowsByService.map(({ serviceId, serviceType, rows: svcRows }) => {
        const theme = SERVICE_TYPE_INFO[serviceType]
        const metricDataMap = serviceDataMap.get(serviceId) ?? {}
        const svcCustomMap  = customMetricMap.get(serviceId)

        // 全指標を1枚のグラフに重ね書きするか、指標ごとに分けるか
        // → 指標ごとにカードを分けて表示（スケールが異なるため）
        return (
          <div key={serviceId}>
            {/* サービスヘッダ */}
            <div className="flex items-center gap-2 mb-3">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${theme?.badgeClass ?? 'bg-gray-100 text-gray-600'}`}>
                {theme?.icon} {theme?.abbr ?? serviceType}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {svcRows.map((row, rowIdx) => {
                const formula = svcCustomMap?.get(row.metricRef) ?? null
                const values  = !formula ? (metricDataMap[row.metricRef] ?? {}) : {}
                const getV = (label: string): number | null =>
                  formula ? evalFn(formula, metricDataMap, label) : (values[label] ?? null)

                const color        = CHART_COLORS[rowIdx % CHART_COLORS.length]
                const displayLabel = resolveIGLabel(row.metricRef, row.label)
                const chartData    = timeHeaders.map(h => ({ period: h, value: getV(h) }))
                const hasData      = chartData.some(d => d.value !== null)

                const nums = chartData.map(d => d.value).filter((v): v is number => v !== null)
                const yMin = nums.length > 0 ? Math.floor(Math.min(...nums) * 0.9) : 0
                const yMax = nums.length > 0 ? Math.ceil(Math.max(...nums) * 1.1) : 10

                return (
                  <div key={row.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    {/* カードヘッダ */}
                    <div className="flex items-center gap-2 mb-3">
                      {formula && (
                        <span className="text-amber-500 text-[10px] font-bold">✦</span>
                      )}
                      <span style={{ color }} className="text-sm font-semibold truncate flex-1">
                        {displayLabel}
                      </span>
                      {nums.length > 0 && (
                        <span className="text-xs font-mono text-gray-500 flex-shrink-0">
                          最新: {formatCell(nums[nums.length - 1], row.metricRef)}
                        </span>
                      )}
                    </div>

                    {hasData ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis
                            dataKey="period"
                            tick={{ fontSize: 9, fill: '#9ca3af' }}
                            interval="preserveStartEnd"
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            domain={[yMin, yMax]}
                            tick={{ fontSize: 9, fill: '#9ca3af' }}
                            tickLine={false}
                            axisLine={false}
                            width={52}
                            tickFormatter={(v: number) => formatCell(v, row.metricRef)}
                          />
                          <Tooltip
                            formatter={(v) => [formatCell(v as number | null, row.metricRef), displayLabel]}
                            labelStyle={{ fontSize: 10 }}
                            contentStyle={{ fontSize: 10, borderRadius: 8, border: '1px solid #e5e7eb' }}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={color}
                            strokeWidth={2}
                            dot={{ r: 3, fill: color, strokeWidth: 0 }}
                            activeDot={{ r: 5 }}
                            connectNulls={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[180px] flex items-center justify-center text-xs text-gray-400">
                        データがありません
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 複合グラフモード: サービスごとにチェックボックス選択 + 1枚グラフ ───────────

/** サービス1つ分の複合折れ線グラフ（state を内部に持つ独立コンポーネント） */
function UnifiedServiceCombinedChart({
  serviceType,
  rows,
  metricDataMap,
  customMap,
  timeHeaders,
  formatCell,
  evalFn,
}: {
  serviceType: string
  rows: UnifiedTableRow[]
  metricDataMap: Record<string, Record<string, number | null>>
  customMap: Map<string, FormulaNode> | undefined
  timeHeaders: string[]
  formatCell: (v: number | null, ref: string) => string
  evalFn: (f: FormulaNode, d: Record<string, Record<string, number | null>>, label: string) => number | null
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(rows.map((_, i) => i)),
  )

  const toggle = (i: number) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) {
        if (next.size > 1) next.delete(i)
      } else {
        next.add(i)
      }
      return next
    })

  const theme = SERVICE_TYPE_INFO[serviceType]

  // { period: h, m_0: val, m_1: val, ... }
  const chartData = timeHeaders.map(h => {
    const point: Record<string, string | number | null> = { period: h }
    rows.forEach((row, i) => {
      const formula = customMap?.get(row.metricRef) ?? null
      point[`m_${i}`] = formula
        ? evalFn(formula, metricDataMap, h)
        : (metricDataMap[row.metricRef]?.[h] ?? null)
    })
    return point
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      {/* サービスヘッダ */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${theme?.badgeClass ?? 'bg-gray-100 text-gray-600'}`}>
          {theme?.icon} {theme?.abbr ?? serviceType}
        </span>
      </div>

      {/* チェックボックスパネル */}
      <p className="text-[11px] text-gray-400 mb-3">表示する指標を選択（複数可）</p>
      <div className="flex flex-wrap gap-2 mb-5 pb-4 border-b border-gray-100">
        {rows.map((row, i) => {
          const color        = CHART_COLORS[i % CHART_COLORS.length]
          const checked      = selected.has(i)
          const displayLabel = resolveIGLabel(row.metricRef, row.label)
          return (
            <label
              key={i}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer select-none transition-all text-xs font-medium ${
                checked ? 'bg-white shadow-sm' : 'bg-gray-50 opacity-40'
              }`}
              style={{ borderColor: checked ? color : '#e5e7eb' }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(i)}
                className="sr-only"
              />
              <span
                className="w-3.5 h-3.5 rounded-sm flex-shrink-0 flex items-center justify-center transition-colors"
                style={{ backgroundColor: checked ? color : '#d1d5db' }}
              >
                {checked && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 12 12">
                    <polyline points="2,6 5,9 10,3" />
                  </svg>
                )}
              </span>
              <span style={{ color: checked ? color : '#9ca3af' }}>
                {customMap?.has(row.metricRef) && <span className="mr-1 text-amber-500">✦</span>}
                {displayLabel}
              </span>
            </label>
          )
        })}
      </div>

      {/* 複合折れ線グラフ */}
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 8, right: 20, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            interval="preserveStartEnd"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatCell(v, '')}
          />
          <Tooltip
            formatter={(v, name) => {
              const idx = rows.findIndex(r => resolveIGLabel(r.metricRef, r.label) === (name as string))
              const ref = idx >= 0 ? rows[idx].metricRef : ''
              return [formatCell(v as number | null, ref), name as string]
            }}
            labelStyle={{ fontSize: 10 }}
            contentStyle={{ fontSize: 10, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 12 }} />
          {rows.map((row, i) => {
            const displayLabel = resolveIGLabel(row.metricRef, row.label)
            return selected.has(i) ? (
              <Line
                key={i}
                type="monotone"
                dataKey={`m_${i}`}
                name={displayLabel}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            ) : null
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function UnifiedCombinedChartView({
  rowsByService,
  serviceDataMap,
  customMetricMap,
  timeHeaders,
  formatCell,
  evalFormula: evalFn,
}: {
  rowsByService: ServiceGroup[]
  serviceDataMap: Map<string, Record<string, Record<string, number | null>>>
  customMetricMap: Map<string, Map<string, FormulaNode>>
  timeHeaders: string[]
  formatCell: (v: number | null, ref: string) => string
  evalFormula: (f: FormulaNode, d: Record<string, Record<string, number | null>>, label: string) => number | null
}) {
  return (
    <div className="space-y-6">
      {rowsByService.map(({ serviceId, serviceType, rows: svcRows }) => (
        <UnifiedServiceCombinedChart
          key={serviceId}
          serviceType={serviceType}
          rows={svcRows}
          metricDataMap={serviceDataMap.get(serviceId) ?? {}}
          customMap={customMetricMap.get(serviceId)}
          timeHeaders={timeHeaders}
          formatCell={formatCell}
          evalFn={evalFn}
        />
      ))}
    </div>
  )
}

// ── メインページ ─────────────────────────────────────────────────────────────

export default function UnifiedTemplateViewPage({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>
}) {
  const { projectId, templateId } = use(params)

  const [displayMode, setDisplayMode] = useState<'table' | 'chart' | 'combined'>('table')

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
      for (const sid of uniqueServiceIds) map[sid] = []
      for (const { serviceId, data } of results) map[serviceId] = data
      setCustomMetricsByService(map)
    }).catch(() => {
      const map: Record<string, LibraryMetric[]> = {}
      for (const sid of uniqueServiceIds) map[sid] = []
      setCustomMetricsByService(map)
    })
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

  /** カスタム指標 API の初回取得完了（各行の serviceId で配列が揃うまでクエリしない） */
  const customMetricsReady = useMemo(() => {
    if (!tmpl || tmpl.rows.length === 0) return true
    const ids = [...new Set(tmpl.rows.map((r) => r.serviceId))]
    return ids.every((sid) => Array.isArray(customMetricsByService[sid]))
  }, [tmpl, customMetricsByService])

  // ── プロジェクト名 ─────────────────────────────────────────────
  const { data: projectData } = useSWR<{ success: boolean; data: { project_name: string } }>(
    `/api/projects/${projectId}`,
    fetcher,
  )
  const projectName = projectData?.data?.project_name ?? ''

  // ── サマリーデータ取得（テンプレに必要な fieldRef のみ）──────────────────
  interface UnifiedService {
    id: string
    name: string
    serviceType: string
    metrics: Record<string, { label: string; category: string; values: Record<string, number | null> }>
  }

  const summaryQueryBody = useMemo(() => {
    if (!tmpl || tmpl.rows.length === 0) return null
    if (!customMetricsReady) return null
    if (tmpl.timeUnit === 'custom_range') {
      if (!tmpl.rangeStart || !tmpl.rangeEnd || tmpl.rangeStart > tmpl.rangeEnd) return null
    }
    const serviceBlocks = collectUnifiedTemplateFieldRefs(tmpl.rows, customMetricMap)
    if (serviceBlocks.length === 0) return null
    const body: Record<string, unknown> = {
      timeUnit: tmpl.timeUnit,
      count: tmpl.count,
      services: serviceBlocks,
    }
    if (tmpl.timeUnit === 'custom_range' && tmpl.rangeStart && tmpl.rangeEnd) {
      body.rangeStart = tmpl.rangeStart
      body.rangeEnd = tmpl.rangeEnd
    }
    return body
  }, [tmpl, customMetricMap, customMetricsReady])

  const summaryQueryKey = useMemo((): [string, Record<string, unknown>] | null => {
    if (!tmpl || !summaryQueryBody) return null
    return [`/api/projects/${projectId}/unified-summary/query`, summaryQueryBody]
  }, [projectId, tmpl, summaryQueryBody])

  const { data: summaryData, isLoading } = useSWR(
    summaryQueryKey,
    unifiedSummaryQueryFetcher,
  )

  const timeHeaders = useMemo(
    () => tmpl ? generateTimeHeaders(tmpl.timeUnit, tmpl.count, tmpl.rangeStart, tmpl.rangeEnd) : [],
    [tmpl],
  )

  // day 単位のとき: ヘッダラベル → dateKey（YYYY-MM-DD）マッピング
  const labelToDateKey = useMemo<Map<string, string>>(() => {
    if (!tmpl || tmpl.timeUnit !== 'day') return new Map()
    return new Map(generateJstDayPeriods(tmpl.count).map(p => [p.label, p.dateKey]))
  }, [tmpl])

  // 外因変数取得（day 単位のみ）
  const externalDataUrl = useMemo(() => {
    if (!tmpl || tmpl.timeUnit !== 'day' || timeHeaders.length === 0) return null
    const keys = timeHeaders.map(h => labelToDateKey.get(h)).filter((k): k is string => !!k)
    if (keys.length === 0) return null
    return `/api/projects/${projectId}/unified-summary/external?from=${keys[0]}&to=${keys[keys.length - 1]}`
  }, [tmpl, timeHeaders, labelToDateKey, projectId])

  const { data: externalResp } = useSWR<{ success: boolean; data: ExternalData }>(
    externalDataUrl,
    fetcher,
  )
  const externalData = externalResp?.success ? externalResp.data : null

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
          {/* 表示モード切替 */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setDisplayMode('table')}
              title="テーブル表示"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                displayMode === 'table'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
              </svg>
              表
            </button>
            <button
              onClick={() => setDisplayMode('chart')}
              title="指標ごとにグラフ表示"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                displayMode === 'chart'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16" />
              </svg>
              個別
            </button>
            <button
              onClick={() => setDisplayMode('combined')}
              title="複数指標を1枚のグラフで表示"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                displayMode === 'combined'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16l4-5 4 3 4-7 4 4" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} strokeOpacity={0.4} d="M3 19l4-3 4 1 4-4 4 2" />
              </svg>
              複合
            </button>
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
        {!isLoading && hasRows && displayMode === 'table' && (
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
                    {timeHeaders.map((h, i) => {
                      const dk  = labelToDateKey.get(h)
                      const ext = dk ? externalData?.dates[dk] : null
                      const isLast = i === timeHeaders.length - 1
                      return (
                        <th
                          key={h}
                          className={`px-3 py-2 text-center font-medium ${
                            isLast ? 'text-gray-900 bg-blue-50' : 'text-gray-500'
                          }`}
                        >
                          <div className="whitespace-nowrap">{h}</div>
                          {ext?.is_holiday && (
                            <div className="mt-0.5 text-[9px] font-normal text-pink-600 whitespace-nowrap">
                              🎌 {ext.holiday_name ?? '祝日'}
                            </div>
                          )}
                          {externalData?.hasWeather && ext?.temperature_max != null && (
                            <div className="mt-0.5 text-[9px] font-normal text-sky-500 whitespace-nowrap">
                              {weatherEmoji(ext.weather_code)} {ext.temperature_max}°/{ext.temperature_min}°
                            </div>
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rowsByService.map(({ serviceId, serviceType, rows: svcRows }, grpIdx) => {
                    const theme = SERVICE_TYPE_INFO[serviceType]
                    const metricDataMap = serviceDataMap.get(serviceId) ?? {}
                    const svcCustomMap  = customMetricMap.get(serviceId)

                    return svcRows.map((row, rowIdx) => {
                      const formula = svcCustomMap?.get(row.metricRef) ?? null
                      const values = !formula ? (metricDataMap[row.metricRef] ?? {}) : {}
                      const getV = (label: string): number | null =>
                        formula ? evalFormula(formula, metricDataMap, label) : (values[label] ?? null)

                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-gray-100 hover:bg-gray-50/70 transition
                            ${rowIdx === 0 && grpIdx > 0 ? 'border-t-2 border-t-gray-200' : ''}`}
                        >
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
                          <td className="px-4 py-2 text-gray-700 font-medium whitespace-nowrap sticky left-24 bg-white z-[5] border-r border-gray-100">
                            {formula && <span className="mr-1 text-amber-500 text-[10px]">✦</span>}
                            {resolveIGLabel(row.metricRef, row.label)}
                          </td>
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
            <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400 flex items-center gap-4">
              <span>{tmpl.rows.length} 指標</span>
              <span>最終列：{timeHeaders[timeHeaders.length - 1]}</span>
              {tmpl.timeUnit === 'day' && (
                <span className="ml-auto">最右列に前日比（▲▼）を表示</span>
              )}
            </div>
          </div>
        )}

        {/* ── 個別グラフモード ──────────────────────────────────── */}
        {!isLoading && hasRows && displayMode === 'chart' && (
          <UnifiedChartView
            rowsByService={rowsByService}
            serviceDataMap={serviceDataMap}
            customMetricMap={customMetricMap}
            timeHeaders={timeHeaders}
            formatCell={formatCell}
            evalFormula={evalFormula}
          />
        )}

        {/* ── 複合グラフモード ──────────────────────────────────── */}
        {!isLoading && hasRows && displayMode === 'combined' && (
          <UnifiedCombinedChartView
            rowsByService={rowsByService}
            serviceDataMap={serviceDataMap}
            customMetricMap={customMetricMap}
            timeHeaders={timeHeaders}
            formatCell={formatCell}
            evalFormula={evalFormula}
          />
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
