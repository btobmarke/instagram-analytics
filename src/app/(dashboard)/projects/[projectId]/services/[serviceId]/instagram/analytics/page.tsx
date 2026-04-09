'use client'

import { useState, use, useEffect, useCallback } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
  type_config: { ig_account_ref_id?: string } | null
}

interface AnalyticsData {
  account_insights: Array<{ metric_code: string; value_date: string; value: number | null }>
  follower_data: Array<{ value_date: string; value: number | null }>
  kpi_results: Array<{ actual_value: number | null; kpi_master: { kpi_code: string; kpi_name: string; unit_type: string } | null }>
  kpi_progress: Array<{
    actual_value: number | null
    target_value: number | null
    achievement_rate: number | null
    status: string
    kpi_result: { kpi_id: string; kpi_master: { kpi_code: string; kpi_name: string } | null } | null
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

function SummaryCard({ label, value, color = 'text-gray-900' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 text-center">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  )
}

export default function ServiceAnalyticsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: serviceData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = serviceData?.data
  const accountId = service?.type_config?.ig_account_ref_id

  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')

  const since = (() => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  })()

  const fetchData = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    const res = await fetch(`/api/analytics?account=${accountId}&since=${since}&metrics=reach,views,impressions,profile_views,follower_count`)
    const json = await res.json()
    setData(json.data)
    setLoading(false)
  }, [accountId, since])

  useEffect(() => { fetchData() }, [fetchData])

  // チャートデータ
  const followerChartData = (data?.follower_data ?? []).map(r => ({
    date: new Date(r.value_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }),
    フォロワー: r.value,
  }))

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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
        <Link href="/clients" className="hover:text-purple-600">クライアント一覧</Link>
        <span>›</span>
        <Link href={`/clients/${service?.client.id}`} className="hover:text-purple-600">{service?.client.client_name}</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">{service?.project.project_name}</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/instagram`} className="hover:text-pink-600">
          {service?.service_name ?? 'Instagram'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">アカウントインサイト</span>
      </nav>

      {/* サービスヘッダー */}
      <div className="flex items-center gap-3 -mt-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-xl">📸</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instagram</h1>
          <p className="text-sm text-gray-400">{service?.service_name}</p>
        </div>
      </div>

      {/* タブナビ */}
      <div className="flex items-center gap-1 border-b border-gray-200 -mt-2">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/analytics`}
          className="px-4 py-2.5 text-sm font-medium text-pink-600 border-b-2 border-pink-600 -mb-px"
        >
          ダッシュボード
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/posts`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          投稿一覧
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/ai`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          AI分析
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          設定
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/summary`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          サマリー
        </Link>
      </div>

      {!accountId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center text-amber-800">
          <p className="font-semibold mb-1">Instagram アカウントが未連携です</p>
          <Link href={`/projects/${projectId}/services/${serviceId}/instagram`}
            className="text-sm text-amber-700 font-medium hover:underline">
            ← サービスページでアカウントを連携する
          </Link>
        </div>
      ) : (
        <>
          {/* ヘッダー */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">アカウントインサイト</h1>
            <div className="flex gap-2">
              {(['7d', '30d', '90d'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${period === p ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {p === '7d' ? '7日' : p === '30d' ? '30日' : '90日'}
                </button>
              ))}
            </div>
          </div>

          {/* KPI達成状況 */}
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
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>{style.label}</span>
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

          {/* 投稿サマリー */}
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

          {/* チャート */}
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              {/* フォロワー推移 */}
              {followerChartData.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">フォロワー推移</h2>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={followerChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} width={50} />
                      <Tooltip />
                      <Line type="monotone" dataKey="フォロワー" stroke="#7c3aed" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* リーチ推移 */}
              {reachChartData.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">リーチ / 表示回数</h2>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={reachChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} width={50} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="リーチ" fill="#7c3aed" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="表示回数" fill="#a78bfa" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* AI分析（専用タブへ誘導） */}
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">AI 分析レポート</h2>
              <p className="text-xs text-gray-500 mt-1">
                週次・月次レポートをストリーミング生成し、過去の分析も閲覧できます。
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/services/${serviceId}/instagram/ai`}
              className="inline-flex justify-center items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition shrink-0"
            >
              AI分析タブを開く
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
