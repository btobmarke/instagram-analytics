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
  total_sessions: number
  total_users: number
  pages_per_session: number
  scroll_depth_avg_pct: number
  active_time_sec_avg: number
  rage_click_sessions: number
  dead_click_sessions: number
  quick_back_sessions: number
  excessive_scroll_sessions: number
  js_error_sessions: number
}

interface PageMetric {
  page_url: string
  sessions: number
  total_users: number
  scroll_depth_avg_pct: number
  active_time_sec_avg: number
  rage_clicks: number
  dead_clicks: number
  quick_backs: number
  js_errors: number
}

interface DeviceMetric {
  device_type: string
  sessions: number
  total_users: number
}

interface ClarityData {
  days: number
  since: string
  daily: DailyMetric[]
  pages: PageMetric[]
  devices: DeviceMetric[]
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------
const DAYS_OPTIONS = [
  { value: 7, label: '7日間' },
  { value: 30, label: '30日間' },
  { value: 90, label: '90日間' },
]

const DEVICE_COLORS: Record<string, string> = {
  Mobile: '#8b5cf6',
  Desktop: '#3b82f6',
  Tablet: '#10b981',
}
const DEVICE_FALLBACK_COLORS = ['#f59e0b', '#ef4444', '#6b7280']

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

function sum(arr: DailyMetric[], key: keyof DailyMetric): number {
  return arr.reduce((acc, d) => acc + (Number(d[key]) || 0), 0)
}

function avg(arr: DailyMetric[], key: keyof DailyMetric): number {
  if (arr.length === 0) return 0
  return sum(arr, key) / arr.length
}

// ---------------------------------------------------------------------------
// KPI カード
// ---------------------------------------------------------------------------
function KpiCard({
  icon, label, value, sub,
  color = 'purple',
}: {
  icon: string
  label: string
  value: string
  sub?: string
  color?: 'purple' | 'blue' | 'green' | 'amber' | 'red'
}) {
  const bg = {
    purple: 'bg-purple-50 text-purple-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  }[color]

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
// 問題行動バッジ
// ---------------------------------------------------------------------------
function IssueBadge({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value.toLocaleString()}<span className="text-sm font-normal text-gray-400 ml-1">件</span></p>
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
        <span className="text-xs text-gray-400">{pct}%</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// メインページ
// ---------------------------------------------------------------------------
export default function ClarityAnalyticsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [days, setDays] = useState(30)

  const { data: serviceData } = useSWR<{ success: boolean; data: Record<string, unknown> }>(
    `/api/services/${serviceId}`,
    fetcher
  )

  const { data: clarityResp, isLoading } = useSWR<{ success: boolean; data: ClarityData }>(
    `/api/services/${serviceId}/clarity?days=${days}`,
    fetcher
  )

  const service = serviceData?.data
  const cd = clarityResp?.data

  const daily = cd?.daily ?? []
  const pages = cd?.pages ?? []
  const devices = cd?.devices ?? []

  // KPI 集計
  const totalSessions = sum(daily, 'total_sessions')
  const totalUsers = sum(daily, 'total_users')
  const avgScrollDepth = avg(daily, 'scroll_depth_avg_pct')
  const avgActiveTime = avg(daily, 'active_time_sec_avg')
  const totalRageClicks = sum(daily, 'rage_click_sessions')
  const totalDeadClicks = sum(daily, 'dead_click_sessions')
  const totalQuickBacks = sum(daily, 'quick_back_sessions')
  const totalJsErrors = sum(daily, 'js_error_sessions')

  // デバイス合計
  const totalDeviceSessions = devices.reduce((a, d) => a + d.sessions, 0)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6 flex-wrap">
        <Link href="/clients" className="hover:text-purple-600">クライアント一覧</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">プロジェクト</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/lp`} className="hover:text-purple-600">
          {service?.service_name as string ?? 'LP'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">Clarity 分析</span>
      </nav>

      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white font-bold text-sm">C</div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Microsoft Clarity 分析</h1>
            <p className="text-sm text-gray-400">ユーザー行動・問題行動の可視化</p>
          </div>
        </div>
        {/* 期間選択 */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {DAYS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                days === opt.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
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
          <p className="text-4xl mb-3">📭</p>
          <p className="text-lg font-semibold text-gray-700 mb-1">データがありません</p>
          <p className="text-sm text-gray-400">Clarity バッチを実行してデータを収集してください</p>
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
            <KpiCard icon="👥" label="総セッション数" value={totalSessions.toLocaleString()} sub={`ユーザー: ${totalUsers.toLocaleString()}`} color="blue" />
            <KpiCard icon="📜" label="平均スクロール深度" value={`${avgScrollDepth.toFixed(1)}%`} color="purple" />
            <KpiCard icon="⏱️" label="平均アクティブ時間" value={fmtSec(avgActiveTime)} color="green" />
            <KpiCard
              icon="⚠️"
              label="問題行動合計"
              value={(totalRageClicks + totalDeadClicks + totalQuickBacks + totalJsErrors).toLocaleString()}
              sub="怒りクリック+デッド+すぐ離脱+JS"
              color="red"
            />
          </div>

          {/* ============================================================ */}
          {/* セッション推移                                                 */}
          {/* ============================================================ */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">セッション・ユーザー推移</h2>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily.map(d => ({
                date: fmtDate(d.report_date),
                セッション: d.total_sessions,
                ユーザー: d.total_users,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="セッション" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ユーザー" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ============================================================ */}
          {/* エンゲージメント推移 + デバイス内訳                           */}
          {/* ============================================================ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* スクロール深度・アクティブ時間 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">エンゲージメント推移</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={daily.map(d => ({
                  date: fmtDate(d.report_date),
                  スクロール深度: Number(d.scroll_depth_avg_pct),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'スクロール深度']} />
                  <Line type="monotone" dataKey="スクロール深度" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* デバイス内訳 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">デバイス内訳</h2>
              {devices.length === 0 ? (
                <p className="text-sm text-gray-400 py-10 text-center">データなし</p>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie data={devices} dataKey="sessions" nameKey="device_type" cx="50%" cy="50%" outerRadius={70} label={false}>
                        {devices.map((d, i) => (
                          <Cell key={d.device_type} fill={DEVICE_COLORS[d.device_type] ?? DEVICE_FALLBACK_COLORS[i % DEVICE_FALLBACK_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [v.toLocaleString(), 'セッション']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {devices.map((d, i) => {
                      const color = DEVICE_COLORS[d.device_type] ?? DEVICE_FALLBACK_COLORS[i % DEVICE_FALLBACK_COLORS.length]
                      const pct = totalDeviceSessions > 0 ? Math.round((d.sessions / totalDeviceSessions) * 100) : 0
                      return (
                        <div key={d.device_type} className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-xs text-gray-600 flex-1">{d.device_type}</span>
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
          {/* 問題行動                                                       */}
          {/* ============================================================ */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">問題行動の推移</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={daily.map(d => ({
                date: fmtDate(d.report_date),
                怒りクリック: d.rage_click_sessions,
                デッドクリック: d.dead_click_sessions,
                すぐ離脱: d.quick_back_sessions,
                JSエラー: d.js_error_sessions,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="怒りクリック" stackId="a" fill="#ef4444" />
                <Bar dataKey="デッドクリック" stackId="a" fill="#f97316" />
                <Bar dataKey="すぐ離脱" stackId="a" fill="#f59e0b" />
                <Bar dataKey="JSエラー" stackId="a" fill="#6b7280" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 問題行動サマリーバッジ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <IssueBadge label="怒りクリック" value={totalRageClicks} total={totalSessions} color="#ef4444" />
            <IssueBadge label="デッドクリック" value={totalDeadClicks} total={totalSessions} color="#f97316" />
            <IssueBadge label="すぐ離脱（クイックバック）" value={totalQuickBacks} total={totalSessions} color="#f59e0b" />
            <IssueBadge label="JS エラー" value={totalJsErrors} total={totalSessions} color="#6b7280" />
          </div>

          {/* ============================================================ */}
          {/* ページ別パフォーマンス                                        */}
          {/* ============================================================ */}
          {pages.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">ページ別パフォーマンス</h2>
                <p className="text-xs text-gray-400 mt-0.5">上位 {pages.length} ページ（セッション数順）</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['ページURL', 'セッション', 'スクロール深度', 'アクティブ時間', '怒りC', 'デッドC', '離脱', 'JSエラー'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pages.map(p => (
                      <tr key={p.page_url} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 max-w-xs">
                          <p className="text-xs text-gray-700 truncate" title={p.page_url}>{p.page_url}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">{p.sessions.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">{p.scroll_depth_avg_pct}%</td>
                        <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">{fmtSec(p.active_time_sec_avg)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${p.rage_clicks > 0 ? 'text-red-700 bg-red-50' : 'text-gray-400'}`}>
                            {p.rage_clicks}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${p.dead_clicks > 0 ? 'text-orange-700 bg-orange-50' : 'text-gray-400'}`}>
                            {p.dead_clicks}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${p.quick_backs > 0 ? 'text-amber-700 bg-amber-50' : 'text-gray-400'}`}>
                            {p.quick_backs}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${p.js_errors > 0 ? 'text-gray-700 bg-gray-100' : 'text-gray-400'}`}>
                            {p.js_errors}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
