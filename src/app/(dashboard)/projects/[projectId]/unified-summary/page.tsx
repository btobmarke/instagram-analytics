'use client'

import { useState, use, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR, { mutate as swrMutate } from 'swr'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { wmoCodeToEmoji } from '@/lib/external/weather'
import type { ProjectSummaryTemplate } from './_lib/types'
import { TIME_UNIT_LABELS } from './_lib/types'
import { listTemplates, createTemplate } from './_lib/store'
import { AnalysisTab } from './_components/AnalysisTab'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 型定義 ──────────────────────────────────────────────────────────────────

type TimeUnit = 'day' | 'week' | 'month'

interface MetricCard {
  id: string
  label: string
  category: string
}

interface ConfigService {
  id: string
  name: string
  serviceType: string
  availableMetrics: MetricCard[]
}

interface UnifiedService {
  id: string
  name: string
  serviceType: string
  metrics: Record<string, {
    label: string
    category: string
    values: Record<string, number | null>
  }>
}

interface UnifiedSummaryData {
  periods: string[]
  services: UnifiedService[]
}

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

// ── サービス別デフォルト表示指標 ────────────────────────────────────────────

const SERVICE_DEFAULT_METRICS: Record<string, string[]> = {
  instagram: [
    'ig_account_insight_fact.follower_count',
    'ig_account_insight_fact.reach',
    'ig_account_insight_fact.likes',
    'ig_account_insight_fact.accounts_engaged',
  ],
  gbp: [
    'gbp_performance_daily.business_impressions_mobile_search',
    'gbp_performance_daily.call_clicks',
    'gbp_performance_daily.website_clicks',
    'gbp_performance_daily.business_direction_requests',
  ],
  line: [
    'line_oam_friends_daily.contacts',
    'line_oam_friends_daily.target_reaches',
    'line_oam_friends_daily.blocks',
  ],
  lp: [
    'metric_summaries.session_count',
    'metric_summaries.user_count',
    'metric_summaries.hot_session_rate',
    'metric_summaries.avg_stay_seconds',
  ],
  google_ads: [
    'google_ads_campaign_daily.impressions',
    'google_ads_campaign_daily.clicks',
    'google_ads_campaign_daily.cost_micros',
  ],
}

const SERVICE_TYPE_INFO: Record<string, { label: string; abbr: string; icon: string; color: string; bgColor: string; badgeClass: string }> = {
  instagram: { label: 'Instagram',  abbr: 'IG',      icon: '📸', color: 'text-pink-700',   bgColor: 'bg-pink-50 border-pink-200',   badgeClass: 'bg-pink-100 text-pink-700' },
  gbp:       { label: 'GBP',        abbr: 'GBP',     icon: '🏢', color: 'text-teal-700',   bgColor: 'bg-teal-50 border-teal-200',   badgeClass: 'bg-teal-100 text-teal-700' },
  line:      { label: 'LINE',       abbr: 'LINE',    icon: '💬', color: 'text-green-700',  bgColor: 'bg-green-50 border-green-200', badgeClass: 'bg-green-100 text-green-700' },
  lp:        { label: 'LP',         abbr: 'LP',      icon: '🎯', color: 'text-orange-700', bgColor: 'bg-orange-50 border-orange-200',badgeClass: 'bg-orange-100 text-orange-700' },
  google_ads:{ label: 'Google広告', abbr: 'GAds',    icon: '🔍', color: 'text-blue-700',   bgColor: 'bg-blue-50 border-blue-200',   badgeClass: 'bg-blue-100 text-blue-700' },
  ga4:       { label: 'GA4',        abbr: 'GA4',     icon: '📊', color: 'text-indigo-700', bgColor: 'bg-indigo-50 border-indigo-200',badgeClass: 'bg-indigo-100 text-indigo-700' },
  clarity:   { label: 'Clarity',    abbr: 'Clarity', icon: '🔬', color: 'text-violet-700', bgColor: 'bg-violet-50 border-violet-200',badgeClass: 'bg-violet-100 text-violet-700' },
}

// ── ユーティリティ ───────────────────────────────────────────────────────────

function formatValue(value: number | null | undefined, metricRef: string): string {
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
  return value >= 10000
    ? `${(value / 10000).toFixed(1)}万`
    : value.toLocaleString()
}

/** 最新期間の値を取得 */
function getLatestValue(
  values: Record<string, number | null>,
  periods: string[],
): number | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    const v = values[periods[i]]
    if (v != null) return v
  }
  return null
}

/** 前期間比（%）を計算 */
function calcChange(
  values: Record<string, number | null>,
  periods: string[],
): number | null {
  let latest: number | null = null
  let latestIdx = -1
  for (let i = periods.length - 1; i >= 0; i--) {
    const v = values[periods[i]]
    if (v != null) { latest = v; latestIdx = i; break }
  }
  if (latest == null || latestIdx <= 0) return null
  let prev: number | null = null
  for (let i = latestIdx - 1; i >= 0; i--) {
    const v = values[periods[i]]
    if (v != null) { prev = v; break }
  }
  if (prev == null || prev === 0) return null
  return ((latest - prev) / prev) * 100
}

/**
 * 期間ラベル（"4/6" など）から YYYY-MM-DD を逆算する。
 * timeUnit=day の場合のみ動作。
 * periods の順番から逆算（今日が末尾）
 */
function periodLabelToDate(label: string, periods: string[]): string | null {
  const idx = periods.indexOf(label)
  if (idx < 0) return null
  const now = new Date()
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const offset = periods.length - 1 - idx
  const d = new Date(jstNow.getTime() - offset * 86400000)
  return d.toISOString().slice(0, 10)
}

// ── サブコンポーネント ────────────────────────────────────────────────────────

function ChangeBadge({ change }: { change: number | null }) {
  if (change == null) return null
  const positive = change >= 0
  return (
    <span className={`text-xs font-medium ${positive ? 'text-green-600' : 'text-red-500'}`}>
      {positive ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
    </span>
  )
}

// ── グラフカラーパレット ──────────────────────────────────────────────────────
const REPORT_CHART_COLORS = [
  '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
]

// ── サービスカード（カードモード） ────────────────────────────────────────────
function ServiceCard({ service, periods }: { service: UnifiedService; periods: string[] }) {
  const info = SERVICE_TYPE_INFO[service.serviceType] ?? {
    label: service.serviceType, abbr: service.serviceType, icon: '⚙️',
    color: 'text-gray-700', bgColor: 'bg-gray-50 border-gray-200',
  }
  const defaultRefs = SERVICE_DEFAULT_METRICS[service.serviceType] ?? []
  const displayRefs = defaultRefs.filter(ref => service.metrics[ref])

  if (displayRefs.length === 0) {
    return (
      <div className={`rounded-xl border p-4 ${info.bgColor}`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">{info.icon}</span>
          <div>
            <p className={`text-xs font-semibold ${info.color}`}>{info.label}</p>
            <p className="text-sm font-bold text-gray-800">{service.name}</p>
          </div>
        </div>
        <p className="text-xs text-gray-400">データがありません</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-4 ${info.bgColor}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{info.icon}</span>
        <div>
          <p className={`text-xs font-semibold ${info.color}`}>{info.label}</p>
          <p className="text-sm font-bold text-gray-800">{service.name}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {displayRefs.map(ref => {
          const m = service.metrics[ref]
          const latest = getLatestValue(m.values, periods)
          const change = calcChange(m.values, periods)
          return (
            <div key={ref} className="bg-white/70 rounded-lg p-2.5">
              <p className="text-xs text-gray-500 truncate">{m.label}</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">
                {formatValue(latest, ref)}
              </p>
              <ChangeBadge change={change} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── サービスチャート（グラフモード） ──────────────────────────────────────────
function ServiceChart({ service, periods }: { service: UnifiedService; periods: string[] }) {
  const info = SERVICE_TYPE_INFO[service.serviceType] ?? {
    label: service.serviceType, abbr: service.serviceType, icon: '⚙️',
    color: 'text-gray-700', bgColor: 'bg-gray-50 border-gray-200',
  }
  const defaultRefs = SERVICE_DEFAULT_METRICS[service.serviceType] ?? []
  const displayRefs = defaultRefs.filter(ref => service.metrics[ref])

  if (displayRefs.length === 0) {
    return (
      <div className={`rounded-xl border p-4 ${info.bgColor}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{info.icon}</span>
          <p className="text-sm font-bold text-gray-800">{service.name}</p>
        </div>
        <p className="text-xs text-gray-400">データがありません</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-4 ${info.bgColor}`}>
      {/* ヘッダ */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">{info.icon}</span>
        <div>
          <p className={`text-[10px] font-semibold ${info.color}`}>{info.label}</p>
          <p className="text-sm font-bold text-gray-800">{service.name}</p>
        </div>
      </div>

      {/* 指標ごとにミニグラフ */}
      <div className="space-y-4">
        {displayRefs.map((ref, idx) => {
          const m = service.metrics[ref]
          const color = REPORT_CHART_COLORS[idx % REPORT_CHART_COLORS.length]
          const chartData = periods.map(p => ({ period: p, value: m.values[p] ?? null }))
          const hasData   = chartData.some(d => d.value !== null)
          const latest    = getLatestValue(m.values, periods)
          const change    = calcChange(m.values, periods)

          const nums = chartData.map(d => d.value).filter((v): v is number => v !== null)
          const yMin = nums.length > 0 ? Math.floor(Math.min(...nums) * 0.9) : 0
          const yMax = nums.length > 0 ? Math.ceil(Math.max(...nums) * 1.1) : 10

          return (
            <div key={ref} className="bg-white/80 rounded-lg p-3">
              {/* 指標ラベル + 最新値 */}
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs text-gray-500 truncate">{m.label}</p>
                <div className="flex items-baseline gap-1.5 flex-shrink-0 ml-2">
                  <span className="text-sm font-bold text-gray-900">
                    {formatValue(latest, ref)}
                  </span>
                  <ChangeBadge change={change} />
                </div>
              </div>

              {/* 折れ線グラフ */}
              {hasData ? (
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={chartData} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
                    <YAxis domain={[yMin, yMax]} hide />
                    <Tooltip
                      formatter={(v) => [formatValue(v as number | null, ref), m.label]}
                      labelStyle={{ fontSize: 9 }}
                      contentStyle={{ fontSize: 9, borderRadius: 6, border: '1px solid #e5e7eb', padding: '2px 6px' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={color}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[80px] flex items-center justify-center text-xs text-gray-300">
                  データなし
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── レポートタブ ──────────────────────────────────────────────────────────────

function weatherEmoji(code: number | null): string {
  if (code == null) return '—'
  if (code === 0)          return '☀️'
  if (code <= 3)           return '⛅'
  if (code <= 48)          return '🌫️'
  if (code <= 55)          return '🌦️'
  if (code <= 65)          return '🌧️'
  if (code <= 77)          return '❄️'
  if (code <= 82)          return '🌦️'
  return '⛈️'
}

function ReportTab({
  data,
  isLoading,
  externalData,
}: {
  data: UnifiedSummaryData | null
  isLoading: boolean
  externalData: ExternalData | null
}) {
  const [displayMode, setDisplayMode] = useState<'card' | 'chart'>('card')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }
  if (!data || data.services.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <p className="text-sm">サービスが登録されていません</p>
      </div>
    )
  }

  // 今日（JST）の外因変数
  const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
  const todayExt = externalData?.dates[todayKey] ?? null

  return (
    <div>
      {/* 今日の祝日・天気バナー */}
      {(todayExt?.is_holiday || (externalData?.hasWeather && todayExt?.temperature_max != null)) && (
        <div className="flex flex-wrap items-center gap-2 mb-4 px-1">
          {todayExt?.is_holiday && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-pink-50 text-pink-700 border border-pink-200">
              🎌 {todayExt.holiday_name ?? '祝日'}
            </span>
          )}
          {externalData?.hasWeather && todayExt?.temperature_max != null && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
              {weatherEmoji(todayExt.weather_code)}&nbsp;
              {todayExt.temperature_max}° / {todayExt.temperature_min}°
              {todayExt.precipitation_mm != null && todayExt.precipitation_mm > 0 && (
                <span className="ml-1 text-sky-500">💧{todayExt.precipitation_mm}mm</span>
              )}
            </span>
          )}
          <span className="text-[10px] text-gray-400">今日の状況</span>
        </div>
      )}

      {/* 表示モード切替 */}
      <div className="flex justify-end mb-4">
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setDisplayMode('card')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              displayMode === 'card'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            カード
          </button>
          <button
            onClick={() => setDisplayMode('chart')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              displayMode === 'chart'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16" />
            </svg>
            グラフ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.services.map(svc =>
          displayMode === 'card' ? (
            <ServiceCard key={svc.id} service={svc} periods={data.periods} />
          ) : (
            <ServiceChart key={svc.id} service={svc} periods={data.periods} />
          ),
        )}
      </div>
    </div>
  )
}

// ── テンプレートカード ────────────────────────────────────────────────────────

function TemplateCard({ tmpl, projectId, onDelete }: {
  tmpl: ProjectSummaryTemplate
  projectId: string
  onDelete: (id: string) => void
}) {
  const [showConfirm, setShowConfirm] = useState(false)
  const timeLabel = TIME_UNIT_LABELS[tmpl.timeUnit] ?? tmpl.timeUnit
  const updatedAt = new Date(tmpl.updatedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })

  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:border-purple-300 hover:shadow-sm transition group p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{tmpl.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
              {timeLabel}
              {tmpl.timeUnit !== 'custom_range' && ` × ${tmpl.count}`}
            </span>
            <span className="text-[10px] text-gray-400">{tmpl.rows.length} 指標</span>
          </div>
        </div>
        <span className="text-[10px] text-gray-400 flex-shrink-0">{updatedAt}</span>
      </div>

      {/* サービスバッジ */}
      <div className="flex flex-wrap gap-1">
        {[...new Set(tmpl.rows.map(r => r.serviceType))].map(st => {
          const info = SERVICE_TYPE_INFO[st]
          if (!info) return null
          return (
            <span key={st} className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${info.badgeClass}`}>
              {info.icon} {info.abbr}
            </span>
          )
        })}
        {tmpl.rows.length === 0 && (
          <span className="text-[9px] text-gray-300">指標未設定</span>
        )}
      </div>

      {/* アクションボタン */}
      <div className="flex items-center gap-2 mt-auto">
        <Link
          href={`/projects/${projectId}/unified-summary/templates/${tmpl.id}/view`}
          className="flex-1 text-center px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition"
        >
          閲覧
        </Link>
        <Link
          href={`/projects/${projectId}/unified-summary/templates/${tmpl.id}`}
          className="flex-1 text-center px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
        >
          編集
        </Link>
        <button
          onClick={() => setShowConfirm(true)}
          className="px-2 py-1.5 text-xs text-red-400 hover:bg-red-50 rounded-lg transition"
          title="削除"
        >
          🗑
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-72 p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-gray-900 mb-2">「{tmpl.name}」を削除しますか？</p>
            <p className="text-xs text-gray-500 mb-4">この操作は取り消せません。</p>
            <div className="flex gap-2">
              <button onClick={() => setShowConfirm(false)} className="flex-1 px-3 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition">キャンセル</button>
              <button onClick={() => { onDelete(tmpl.id); setShowConfirm(false) }} className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition">削除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── テンプレートリストタブ ────────────────────────────────────────────────────

function TemplateListTab({ projectId }: { projectId: string }) {
  const router = useRouter()
  const templatesKey = `/api/projects/${projectId}/unified-summary/templates`
  const { data: tmplResp, isLoading, mutate } = useSWR<{ success: boolean; data: ProjectSummaryTemplate[] }>(
    templatesKey,
    (url: string) => fetch(url).then(r => r.json()).then(j => ({
      success: j.success,
      data: (j.data ?? []).map((r: Record<string, unknown>) => ({
        id:         r.id,
        projectId:  r.project_id,
        name:       r.name,
        timeUnit:   r.time_unit,
        count:      r.count,
        rangeStart: r.range_start ?? null,
        rangeEnd:   r.range_end   ?? null,
        rows:       Array.isArray(r.rows) ? r.rows : [],
        createdAt:  r.created_at,
        updatedAt:  r.updated_at,
      })),
    })),
  )

  const templates = tmplResp?.data ?? []
  const [creating, setCreating] = useState(false)

  const handleCreate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const newTmpl = await createTemplate(projectId, { name: '新しいテンプレート' })
      await mutate()
      router.push(`/projects/${projectId}/unified-summary/templates/${newTmpl.id}`)
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }, [creating, projectId, mutate, router])

  const handleDelete = useCallback(async (templateId: string) => {
    await fetch(`/api/projects/${projectId}/unified-summary/templates/${templateId}`, { method: 'DELETE' })
    await mutate()
  }, [projectId, mutate])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {templates.length} 個のテンプレート
        </p>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 rounded-xl transition"
        >
          {creating ? '作成中...' : '+ 新規作成'}
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-2xl mb-3">📊</p>
          <p className="text-sm font-medium text-gray-600 mb-1">テンプレートがまだありません</p>
          <p className="text-xs text-gray-400 mb-5">
            複数サービスの指標を組み合わせたカスタムテーブルを作成できます
          </p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition"
          >
            最初のテンプレートを作成
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {templates.map(tmpl => (
            <TemplateCard
              key={tmpl.id}
              tmpl={tmpl}
              projectId={projectId}
              onDelete={handleDelete}
            />
          ))}
          {/* 新規作成カード */}
          <button
            onClick={handleCreate}
            disabled={creating}
            className="bg-white rounded-xl border border-dashed border-gray-300 hover:border-purple-400 hover:bg-purple-50/30 transition p-4 flex flex-col items-center justify-center gap-2 min-h-[140px] text-gray-400 hover:text-purple-500"
          >
            <span className="text-2xl">+</span>
            <span className="text-xs font-medium">新しいテンプレート</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ── データ表タブ（旧 — 後方互換で残す）─────────────────────────────────────

function DataTableTab({
  data,
  configServices,
  externalData,
  projectId,
  isLoading,
  timeUnit,
}: {
  data: UnifiedSummaryData | null
  configServices: ConfigService[]
  externalData: ExternalData | null
  projectId: string
  isLoading: boolean
  timeUnit: TimeUnit
}) {
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [showExternalCols, setShowExternalCols] = useState(true)

  const isFiltered = selectedCategories.size > 0

  interface WideCol {
    key: string
    serviceId: string
    serviceName: string
    serviceType: string
    metricRef: string
    label: string
    category: string
  }

  const columns = useMemo<WideCol[]>(() => {
    if (!data) return []
    return data.services.flatMap(svc => {
      return Object.entries(svc.metrics)
        .filter(([, m]) => {
          if (!isFiltered) return true
          return selectedCategories.has(`${svc.serviceType}::${m.category}`)
        })
        .map(([ref, m]) => ({
          key:         `${svc.id}.${ref}`,
          serviceId:   svc.id,
          serviceName: svc.name,
          serviceType: svc.serviceType,
          metricRef:   ref,
          label:       m.label,
          category:    m.category,
        }))
    })
  }, [data, isFiltered, selectedCategories])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }
  if (!data || data.services.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <p className="text-sm">サービスが登録されていません</p>
      </div>
    )
  }

  const hasExternal = externalData != null
  const hasWeather  = externalData?.hasWeather ?? false
  const isDayUnit   = timeUnit === 'day'

  // 期間ラベル → 日付変換（day のみ）
  const labelToDate = (label: string): string | null => {
    if (!isDayUnit || !data) return null
    return periodLabelToDate(label, data.periods)
  }

  const getExtDay = (label: string): ExternalDayData | null => {
    if (!hasExternal || !isDayUnit) return null
    const d = labelToDate(label)
    if (!d) return null
    return externalData!.dates[d] ?? null
  }

  const info = (type: string) => SERVICE_TYPE_INFO[type] ?? { abbr: type, color: 'text-gray-600' }

  return (
    <div>
      {/* コントロールバー */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-gray-500">
          {columns.length} 列 × {data.periods.length} 行
          {hasExternal && isDayUnit && (
            <span className="ml-2 text-xs text-purple-500">+ 外生変数</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {/* 外生変数トグル */}
          {hasExternal && isDayUnit && (
            <button
              onClick={() => setShowExternalCols(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                showExternalCols
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              🌤️ 祝日・天気
            </button>
          )}
          {/* 外生変数未設定の場合に位置情報登録を促す */}
          {!hasWeather && isDayUnit && (
            <Link
              href={`/projects/${projectId}?settings=location`}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-purple-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              位置情報を設定して天気を表示
            </Link>
          )}
          {/* 列フィルター */}
          <button
            onClick={() => setShowFilterModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            列フィルター {isFiltered && <span className="text-purple-600 font-semibold">({selectedCategories.size})</span>}
          </button>
        </div>
      </div>

      {/* ワイド表 */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm border-collapse">
          <thead>
            {/* サービスグループ行 */}
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 sticky left-0 bg-gray-50 border-r border-gray-200 min-w-[90px]">
                期間
              </th>
              {/* 外生変数グループ */}
              {showExternalCols && hasExternal && isDayUnit && (
                <th
                  colSpan={hasWeather ? 4 : 1}
                  className="px-3 py-2 text-center text-xs font-semibold text-amber-600 border-r border-gray-200"
                >
                  外生変数
                </th>
              )}
              {data.services.map(svc => {
                const cols = columns.filter(c => c.serviceId === svc.id)
                if (cols.length === 0) return null
                const si = info(svc.serviceType)
                return (
                  <th
                    key={svc.id}
                    colSpan={cols.length}
                    className={`px-3 py-2 text-center text-xs font-semibold border-r border-gray-200 ${si.color}`}
                  >
                    [{si.abbr}] {svc.name}
                  </th>
                )
              })}
            </tr>
            {/* 指標名行 */}
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 sticky left-0 bg-gray-50 border-r border-gray-200" />
              {showExternalCols && hasExternal && isDayUnit && (
                <>
                  <th className="px-3 py-2 text-right text-xs font-medium text-amber-600 whitespace-nowrap border-r border-gray-100 min-w-[60px]">祝日</th>
                  {hasWeather && (
                    <>
                      <th className="px-3 py-2 text-right text-xs font-medium text-amber-600 whitespace-nowrap border-r border-gray-100 min-w-[60px]">天気</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-amber-600 whitespace-nowrap border-r border-gray-100 min-w-[70px]">最高気温</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-amber-600 whitespace-nowrap border-r border-gray-100 min-w-[60px]">降水量</th>
                    </>
                  )}
                </>
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap border-r border-gray-100 min-w-[100px]"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.periods.map((period, pi) => {
              const extDay = getExtDay(period)
              const rowBg = extDay?.is_holiday
                ? 'bg-red-50/40'
                : pi % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'

              return (
                <tr key={period} className={rowBg}>
                  <td className={`px-3 py-2 text-xs font-medium sticky left-0 border-r border-gray-200 ${rowBg}`}>
                    <span className={extDay?.is_holiday ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                      {period}
                    </span>
                  </td>
                  {showExternalCols && hasExternal && isDayUnit && (
                    <>
                      <td className="px-3 py-2 text-right text-xs border-r border-gray-100">
                        {extDay?.is_holiday ? (
                          <span className="text-red-500 font-medium text-xs">{extDay.holiday_name ?? '祝日'}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {hasWeather && (
                        <>
                          <td className="px-3 py-2 text-center text-sm border-r border-gray-100">
                            {wmoCodeToEmoji(extDay?.weather_code ?? null)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-gray-700 border-r border-gray-100 tabular-nums">
                            {extDay?.temperature_max != null ? `${extDay.temperature_max}℃` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-gray-700 border-r border-gray-100 tabular-nums">
                            {extDay?.precipitation_mm != null ? `${extDay.precipitation_mm}mm` : '—'}
                          </td>
                        </>
                      )}
                    </>
                  )}
                  {columns.map(col => {
                    const svc = data.services.find(s => s.id === col.serviceId)
                    const v = svc?.metrics[col.metricRef]?.values[period] ?? null
                    return (
                      <td
                        key={col.key}
                        className="px-3 py-2 text-right text-xs text-gray-700 border-r border-gray-100 tabular-nums"
                      >
                        {formatValue(v, col.metricRef)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 列フィルターモーダル */}
      {showFilterModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">表示列を絞り込む</h3>
              <button onClick={() => setShowFilterModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-4">
              {configServices.map(svc => {
                const si = info(svc.serviceType)
                const categories = [...new Set(svc.availableMetrics.map(m => m.category))]
                return (
                  <div key={svc.id}>
                    <p className={`text-xs font-semibold mb-2 ${si.color}`}>[{si.abbr}] {svc.name}</p>
                    <div className="space-y-1">
                      {categories.map(cat => {
                        const key = `${svc.serviceType}::${cat}`
                        const checked = !isFiltered || selectedCategories.has(key)
                        return (
                          <label key={key} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => {
                                const allCats = new Set(
                                  configServices.flatMap(s =>
                                    [...new Set(s.availableMetrics.map(m => `${s.serviceType}::${m.category}`))]
                                  )
                                )
                                const next = new Set(isFiltered ? selectedCategories : allCats)
                                if (e.target.checked) { next.add(key) } else { next.delete(key) }
                                setSelectedCategories(next)
                              }}
                              className="rounded border-gray-300 text-purple-600"
                            />
                            <span className="text-sm text-gray-700">{cat}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="p-4 border-t border-gray-100 flex gap-2">
              <button
                onClick={() => setSelectedCategories(new Set())}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                全て表示
              </button>
              <button
                onClick={() => setShowFilterModal(false)}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
              >
                適用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────────────────────────

const TIME_UNIT_OPTIONS: { value: TimeUnit; label: string; defaultCount: number }[] = [
  { value: 'day',   label: '日',  defaultCount: 14 },
  { value: 'week',  label: '週',  defaultCount: 12 },
  { value: 'month', label: '月',  defaultCount: 12 },
]

export default function UnifiedSummaryPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = use(params)
  const [activeTab, setActiveTab] = useState<'report' | 'templates' | 'analysis'>('report')
  const [timeUnit,  setTimeUnit]  = useState<TimeUnit>('day')

  const currentCount = TIME_UNIT_OPTIONS.find(o => o.value === timeUnit)?.defaultCount ?? 14

  // config（サービス一覧・利用可能指標）
  const { data: configData } = useSWR<{
    success: boolean
    data: { projectId: string; projectName: string; services: ConfigService[] }
  }>(
    `/api/projects/${projectId}/unified-summary/config`,
    fetcher,
  )

  // データ取得
  const dataUrl = `/api/projects/${projectId}/unified-summary?timeUnit=${timeUnit}&count=${currentCount}`
  const { data: summaryResp, isLoading } = useSWR<{
    success: boolean
    data: UnifiedSummaryData
  }>(dataUrl, fetcher)

  const summaryData = summaryResp?.success ? summaryResp.data : null

  // 外生変数（day のみ・データ表タブで使用）
  // 期間の from/to を summaryData の periods から逆算
  const externalParams = useMemo(() => {
    if (!summaryData || timeUnit !== 'day') return null
    const periods = summaryData.periods
    if (periods.length === 0) return null
    const fromDate = periodLabelToDate(periods[0], periods)
    const toDate   = periodLabelToDate(periods[periods.length - 1], periods)
    if (!fromDate || !toDate) return null
    return `from=${fromDate}&to=${toDate}`
  }, [summaryData, timeUnit])

  const { data: externalResp } = useSWR<{
    success: boolean
    data: ExternalData
  }>(
    externalParams && activeTab === 'report'
      ? `/api/projects/${projectId}/unified-summary/external?${externalParams}`
      : null,
    fetcher,
  )
  const externalData = externalResp?.success ? externalResp.data : null

  const project    = configData?.data
  const configSvcs = project?.services ?? []

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/clients" className="hover:text-purple-600">クライアント一覧</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">
          {project?.projectName ?? 'プロジェクト'}
        </Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-700 font-medium">横断サマリー</span>
      </nav>

      {/* ヘッダー */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">横断サマリー</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                {configSvcs.length} サービスのデータを集約
              </p>
            </div>
          </div>

          {/* 時間粒度セレクター */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {TIME_UNIT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTimeUnit(opt.value)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  timeUnit === opt.value
                    ? 'bg-white text-purple-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* サービスバッジ */}
      {configSvcs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {configSvcs.map(svc => {
            const si = SERVICE_TYPE_INFO[svc.serviceType]
            return (
              <span
                key={svc.id}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border ${si?.bgColor ?? 'bg-gray-50 border-gray-200 text-gray-600'}`}
              >
                <span>{si?.icon ?? '⚙️'}</span>
                {svc.name}
              </span>
            )
          })}
        </div>
      )}

      {/* タブ */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {[
          { key: 'report'    as const, label: 'レポート' },
          { key: 'templates' as const, label: 'テンプレート表' },
          { key: 'analysis'  as const, label: '分析' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* コンテンツ */}
      {activeTab === 'report' ? (
        <ReportTab data={summaryData} isLoading={isLoading} externalData={externalData} />
      ) : activeTab === 'templates' ? (
        <TemplateListTab projectId={projectId} />
      ) : (
        <AnalysisTab projectId={projectId} configServices={configSvcs} />
      )}
    </div>
  )
}
