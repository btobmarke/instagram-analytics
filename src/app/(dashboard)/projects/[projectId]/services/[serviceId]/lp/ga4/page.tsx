'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
  ResponsiveContainer,
} from 'recharts'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------
interface DailyMetric {
  report_date: string
  sessions: number
  total_users: number
  new_users: number
  returning_users: number
  engaged_sessions: number
  engagement_rate: number
  bounce_rate: number
  avg_session_duration_sec: number
  screen_page_views: number
  conversions: number
  total_revenue: number
}
interface PageMetric {
  page_path: string; page_title: string | null
  screen_page_views: number; total_users: number; sessions: number
  avg_time_on_page_sec: number; bounce_rate: number; entrances: number; exits: number; conversions: number
}
interface TrafficSource { channel: string; sessions: number; total_users: number; new_users: number; conversions: number }
interface DeviceMetric  { device_category: string; sessions: number; total_users: number }
interface GeoMetric     { area: string; sessions: number; total_users: number }
interface EventMetric   { event_name: string; event_count: number; total_users: number; conversions: number }

interface GA4Data {
  days: number; since: string
  daily: DailyMetric[]; pages: PageMetric[]
  traffic: TrafficSource[]; devices: DeviceMetric[]
  geo: GeoMetric[]; events: EventMetric[]
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------
const DAYS_OPTIONS = [
  { value: 7,  label: '7日間' },
  { value: 30, label: '30日間' },
  { value: 90, label: '90日間' },
]

const DEVICE_COLORS: Record<string, string> = {
  mobile: '#8b5cf6', desktop: '#3b82f6', tablet: '#10b981',
}
const FALLBACK_COLORS = ['#f59e0b', '#ef4444', '#6b7280']

const CHANNEL_COLORS: Record<string, string> = {
  'google / organic':   '#4285F4',
  '(direct) / (none)':  '#34A853',
  'google / cpc':       '#FBBC04',
  'google / referral':  '#EA4335',
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------
function fmtDate(d: string) {
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}
function fmtSec(sec: number) {
  if (sec >= 60) return `${Math.floor(sec / 60)}分${Math.round(sec % 60)}秒`
  return `${Math.round(sec)}秒`
}
function fmtPct(rate: number) { return `${(rate * 100).toFixed(1)}%` }
function sumD(arr: DailyMetric[], key: keyof DailyMetric) {
  return arr.reduce((a, d) => a + (Number(d[key]) || 0), 0)
}
function avgD(arr: DailyMetric[], key: keyof DailyMetric) {
  return arr.length === 0 ? 0 : sumD(arr, key) / arr.length
}

// ---------------------------------------------------------------------------
// KPIカード
// ---------------------------------------------------------------------------
function KpiCard({ icon, label, value, sub, color = 'blue' }: {
  icon: string; label: string; value: string; sub?: string
  color?: 'blue' | 'green' | 'purple' | 'amber' | 'red'
}) {
  const bg = { blue:'bg-blue-50 text-blue-600', green:'bg-green-50 text-green-600',
    purple:'bg-purple-50 text-purple-600', amber:'bg-amber-50 text-amber-600', red:'bg-red-50 text-red-600' }[color]
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${bg}`}>{icon}</span>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// セクションヘッダー
// ---------------------------------------------------------------------------
function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// メインページ
// ---------------------------------------------------------------------------
export default function GA4AnalyticsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [days, setDays] = useState(30)

  const { data: serviceData } = useSWR<{ success: boolean; data: Record<string, unknown> }>(
    `/api/services/${serviceId}`, fetcher
  )
  const { data: ga4Resp, isLoading } = useSWR<{ success: boolean; data: GA4Data }>(
    `/api/services/${serviceId}/ga4?days=${days}`, fetcher
  )

  const service = serviceData?.data
  const gd = ga4Resp?.data
  const daily   = gd?.daily   ?? []
  const pages   = gd?.pages   ?? []
  const traffic = gd?.traffic ?? []
  const devices = gd?.devices ?? []
  const geo     = gd?.geo     ?? []
  const events  = gd?.events  ?? []

  // KPI 集計
  const totalSessions  = sumD(daily, 'sessions')
  const totalUsers     = sumD(daily, 'total_users')
  const totalNewUsers  = sumD(daily, 'new_users')
  const totalPV        = sumD(daily, 'screen_page_views')
  const totalConv      = sumD(daily, 'conversions')
  const avgBounce      = avgD(daily, 'bounce_rate')
  const avgDuration    = avgD(daily, 'avg_session_duration_sec')
  const avgEngagement  = avgD(daily, 'engagement_rate')
  const totalDeviceSessions = devices.reduce((a, d) => a + d.sessions, 0)

  return (
    <div className="p-6 w-full max-w-none min-w-0">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6 flex-wrap">
        <Link href="/clients" className="hover:text-blue-600">クライアント一覧</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-blue-600">プロジェクト</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/lp`} className="hover:text-blue-600">
          {service?.service_name as string ?? 'LP'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">GA4 分析</span>
      </nav>

      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#4285F4' }}>
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Google Analytics 4 分析</h1>
            <p className="text-sm text-gray-400">トラフィック・コンバージョン・ユーザー行動</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {DAYS_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                days === opt.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : daily.length === 0 ? (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-10 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-lg font-semibold text-gray-700 mb-1">データがありません</p>
          <p className="text-sm text-gray-400">GA4 バッチを実行してデータを収集してください</p>
          <Link href="/batch" className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
            バッチ管理へ
          </Link>
        </div>
      ) : (
        <>
          {/* ============================================================ */}
          {/* KPI カード                                                     */}
          {/* ============================================================ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <KpiCard icon="👥" label="総セッション数"     value={totalSessions.toLocaleString()} sub={`ユーザー: ${totalUsers.toLocaleString()}`} color="blue" />
            <KpiCard icon="🆕" label="新規ユーザー"       value={totalNewUsers.toLocaleString()} sub={`全体の ${totalUsers > 0 ? Math.round(totalNewUsers / totalUsers * 100) : 0}%`} color="green" />
            <KpiCard icon="📄" label="総ページビュー"     value={totalPV.toLocaleString()} sub={`直帰率: ${fmtPct(avgBounce)}`} color="purple" />
            <KpiCard icon="🎯" label="コンバージョン"     value={totalConv.toLocaleString()} sub={`平均滞在: ${fmtSec(avgDuration)}`} color="amber" />
          </div>

          {/* ============================================================ */}
          {/* セッション・ユーザー推移                                       */}
          {/* ============================================================ */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
            <SectionHeader title="セッション・ユーザー推移" />
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily.map(d => ({
                date: fmtDate(d.report_date),
                セッション: d.sessions,
                ユーザー: d.total_users,
                新規ユーザー: d.new_users,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="セッション"   stroke="#4285F4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ユーザー"     stroke="#34A853" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="新規ユーザー" stroke="#FBBC04" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ============================================================ */}
          {/* PV・直帰率推移                                                */}
          {/* ============================================================ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <SectionHeader title="ページビュー推移" />
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={daily.map(d => ({ date: fmtDate(d.report_date), PV: d.screen_page_views }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="PV" fill="#4285F4" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <SectionHeader title="エンゲージメント率・直帰率推移" />
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={daily.map(d => ({
                  date: fmtDate(d.report_date),
                  エンゲージメント率: Math.round(Number(d.engagement_rate) * 1000) / 10,
                  直帰率: Math.round(Number(d.bounce_rate) * 1000) / 10,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="エンゲージメント率" stroke="#34A853" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="直帰率"            stroke="#EA4335" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ============================================================ */}
          {/* トラフィックチャネル + デバイス内訳                           */}
          {/* ============================================================ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* チャネル */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <SectionHeader title="流入チャネル TOP10" sub="セッション数順" />
              <div className="space-y-2.5 mt-2">
                {traffic.map((t, i) => {
                  const color = CHANNEL_COLORS[t.channel.toLowerCase()] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
                  const totalTraffic = traffic.reduce((a, x) => a + x.sessions, 0)
                  const pct = totalTraffic > 0 ? Math.round(t.sessions / totalTraffic * 100) : 0
                  return (
                    <div key={t.channel}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600 truncate max-w-[60%]" title={t.channel}>{t.channel}</span>
                        <span className="font-medium text-gray-800">{t.sessions.toLocaleString()} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* デバイス */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <SectionHeader title="デバイス内訳" />
              {devices.length === 0 ? (
                <p className="text-sm text-gray-400 py-10 text-center">データなし</p>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie data={devices} dataKey="sessions" nameKey="device_category" cx="50%" cy="50%" outerRadius={70} label={false}>
                        {devices.map((d, i) => (
                          <Cell key={d.device_category}
                            fill={DEVICE_COLORS[d.device_category.toLowerCase()] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [v.toLocaleString(), 'セッション']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {devices.map((d, i) => {
                      const color = DEVICE_COLORS[d.device_category.toLowerCase()] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
                      const pct = totalDeviceSessions > 0 ? Math.round(d.sessions / totalDeviceSessions * 100) : 0
                      return (
                        <div key={d.device_category} className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-xs text-gray-600 flex-1 capitalize">{d.device_category}</span>
                          <span className="text-xs font-medium text-gray-800">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ============================================================ */}
          {/* ページ別パフォーマンス                                        */}
          {/* ============================================================ */}
          {pages.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-gray-100">
                <SectionHeader title="ページ別パフォーマンス" sub={`上位 ${pages.length} ページ（PV順）`} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['ページ', 'PV', 'ユーザー', '平均滞在時間', '直帰率', 'CV'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pages.map(p => (
                      <tr key={p.page_path} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 max-w-xs">
                          <p className="text-xs font-medium text-gray-700 truncate" title={p.page_path}>{p.page_path}</p>
                          {p.page_title && <p className="text-xs text-gray-400 truncate mt-0.5">{p.page_title}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-800 whitespace-nowrap">{p.screen_page_views.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{p.total_users.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtSec(p.avg_time_on_page_sec)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            p.bounce_rate > 0.7 ? 'text-red-700 bg-red-50' :
                            p.bounce_rate > 0.5 ? 'text-amber-700 bg-amber-50' :
                            'text-green-700 bg-green-50'
                          }`}>
                            {fmtPct(p.bounce_rate)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{p.conversions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* 地域 + イベント                                               */}
          {/* ============================================================ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* 地域 */}
            {geo.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <SectionHeader title="地域別 TOP10" sub="セッション数順" />
                <div className="space-y-2 mt-2">
                  {geo.map((g, i) => {
                    const maxSessions = geo[0]?.sessions ?? 1
                    const pct = Math.round(g.sessions / maxSessions * 100)
                    return (
                      <div key={g.area} className="flex items-center gap-3">
                        <span className="w-5 text-xs text-gray-400 text-right flex-shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-gray-700 truncate">{g.area}</span>
                            <span className="text-gray-500 flex-shrink-0 ml-2">{g.sessions.toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1 overflow-hidden">
                            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* イベント */}
            {events.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <SectionHeader title="イベント TOP10" sub="発火回数順" />
                <div className="space-y-2 mt-2">
                  {events.map((e, i) => {
                    const maxCount = events[0]?.event_count ?? 1
                    const pct = Math.round(e.event_count / maxCount * 100)
                    return (
                      <div key={e.event_name} className="flex items-center gap-3">
                        <span className="w-5 text-xs text-gray-400 text-right flex-shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-gray-700 font-mono truncate">{e.event_name}</span>
                            <span className="text-gray-500 flex-shrink-0 ml-2">{e.event_count.toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1 overflow-hidden">
                            <div className="h-full bg-green-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        {e.conversions > 0 && (
                          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">CV {e.conversions}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
