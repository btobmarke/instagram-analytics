'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import type { AiAnalysisResult } from '@/types'

interface AnalyticsData {
  account_insights: Array<{ metric_code: string; value_date: string; value: number | null }>
  follower_data: Array<{ value_date: string; value: number | null }>
  kpi_results: Array<{ actual_value: number | null; kpi_master: { kpi_code: string; kpi_name: string; unit_type: string } | null }>
  kpi_progress: Array<{
    actual_value: number | null
    target_value: number | null
    achievement_rate: number | null
    status: string
    kpi_result: {
      kpi_id: string
      kpi_master: { kpi_code: string; kpi_name: string } | null
    } | null
  }>
  post_summary: { total: number; feed: number; reels: number; story: number }
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  achieved:          { bg: 'bg-green-100',  text: 'text-green-700',  label: '達成' },
  on_track:          { bg: 'bg-blue-100',   text: 'text-blue-700',   label: '順調' },
  warning:           { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '注意' },
  critical:          { bg: 'bg-red-100',    text: 'text-red-700',    label: '危険' },
  insufficient_data: { bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'データ不足' },
}

function AnalyticsContent() {
  const searchParams = useSearchParams()
  const accountId = searchParams.get('account')

  const [data, setData] = useState<AnalyticsData | null>(null)
  const [aiHistory, setAiHistory] = useState<AiAnalysisResult[]>([])
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')
  const [analysisType, setAnalysisType] = useState<'weekly' | 'monthly'>('weekly')
  const [selectedAi, setSelectedAi] = useState<AiAnalysisResult | null>(null)

  const since = (() => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  })()

  const fetchData = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    const res = await fetch(`/api/analytics?account=${accountId}&since=${since}&metrics=reach,views,impressions,profile_views,follower_count`)
    const json = await res.json()
    setData(json.data)
    setLoading(false)
  }, [accountId, since])

  const fetchAiHistory = useCallback(async () => {
    if (!accountId) return
    const res = await fetch(`/api/analytics/ai?account=${accountId}`)
    const json = await res.json()
    setAiHistory(json.data ?? [])
    if ((json.data ?? []).length > 0) setSelectedAi(json.data[0])
  }, [accountId])

  useEffect(() => { fetchData(); fetchAiHistory() }, [fetchData, fetchAiHistory])

  const handleRunAi = async () => {
    if (!accountId) return
    setAiLoading(true)
    await fetch('/api/analytics/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, analysisType }),
    })
    await fetchAiHistory()
    setAiLoading(false)
  }

  if (!accountId) {
    return <div className="flex items-center justify-center h-64 text-gray-500">サイドバーからアカウントを選択してください</div>
  }

  // Build follower chart data
  const followerChartData = (data?.follower_data ?? []).map(r => ({
    date: new Date(r.value_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }),
    フォロワー: r.value,
  }))

  // Build reach chart data
  const reachMap: Record<string, Record<string, number | null>> = {}
  for (const row of (data?.account_insights ?? [])) {
    if (!reachMap[row.value_date]) reachMap[row.value_date] = {}
    reachMap[row.value_date][row.metric_code] = row.value
  }
  const reachChartData = Object.entries(reachMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, metrics]) => ({
      date: new Date(date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }),
      リーチ: metrics.reach ?? null,
      表示回数: metrics.views ?? metrics.impressions ?? null,
      プロフィール訪問: metrics.profile_views ?? null,
    }))

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">アカウント分析</h1>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${
                period === p ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p === '7d' ? '7日' : p === '30d' ? '30日' : '90日'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Progress */}
      {(data?.kpi_progress ?? []).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">KPI達成状況</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {data!.kpi_progress.slice(0, 6).map((p, i) => {
              const style = STATUS_STYLES[p.status] ?? STATUS_STYLES.insufficient_data
              return (
                <div key={i} className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500 font-medium">{p.kpi_result?.kpi_master?.kpi_name ?? 'KPI'}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {p.achievement_rate != null ? `${p.achievement_rate.toFixed(0)}%` : '—'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    実績: {p.actual_value?.toLocaleString() ?? '—'} / 目標: {p.target_value?.toLocaleString() ?? '—'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Post Summary */}
      {data?.post_summary && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">投稿サマリー（期間内）</h2>
          <div className="grid grid-cols-4 gap-4">
            <SummaryCard label="総投稿数" value={data.post_summary.total} />
            <SummaryCard label="フィード" value={data.post_summary.feed} />
            <SummaryCard label="リール" value={data.post_summary.reels} color="text-purple-600" />
            <SummaryCard label="ストーリー" value={data.post_summary.story} color="text-pink-600" />
          </div>
        </div>
      )}

      {/* Charts */}
      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {/* Follower Chart */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">フォロワー推移</h2>
            {followerChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={followerChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="フォロワー" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </div>

          {/* Reach/Impression Chart */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">リーチ・表示回数推移</h2>
            {reachChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={reachChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="リーチ" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="表示回数" fill="#c4b5fd" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </div>
        </div>
      )}

      {/* AI Analysis */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">AI分析レポート</h2>
          <div className="flex items-center gap-3">
            <select
              value={analysisType}
              onChange={e => setAnalysisType(e.target.value as 'weekly' | 'monthly')}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              <option value="weekly">週次分析</option>
              <option value="monthly">月次分析</option>
            </select>
            <button
              onClick={handleRunAi}
              disabled={aiLoading}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition disabled:opacity-60"
            >
              {aiLoading ? (
                <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />実行中...</>
              ) : (
                <>AI分析を実行</>
              )}
            </button>
          </div>
        </div>

        <div className="flex gap-4">
          {/* History list */}
          {aiHistory.length > 0 && (
            <div className="w-48 flex-shrink-0">
              <p className="text-xs font-medium text-gray-400 uppercase mb-2">履歴</p>
              <div className="space-y-1">
                {aiHistory.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAi(a)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition ${
                      selectedAi?.id === a.id ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <p className="font-medium">{a.analysis_type === 'account_weekly' ? '週次' : '月次'}</p>
                    <p className="text-gray-400">{new Date(a.created_at).toLocaleDateString('ja-JP')}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 bg-gray-50 rounded-xl p-4 min-h-32">
            {selectedAi ? (
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {selectedAi.analysis_result}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                AI分析を実行するとレポートが表示されます
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color = 'text-gray-900' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 text-center">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
      データがありません（バッチ実行後に表示されます）
    </div>
  )
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>}>
      <AnalyticsContent />
    </Suspense>
  )
}
