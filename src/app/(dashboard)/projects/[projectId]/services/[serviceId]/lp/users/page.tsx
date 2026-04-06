'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type RangeType = 'all' | '30d' | '7d' | 'today'
type Temperature = 'hot' | 'cold' | ''

const RANGE_OPTIONS = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '7日間' },
  { value: '30d', label: '30日間' },
  { value: 'all', label: '全期間' },
]

interface LpUserItem {
  userId: string
  anonymousKey: string
  firstVisitedAt: string
  lastVisitedAt: string
  visitCount: number
  totalIntentScore: number
  userTemperature: string
}

export default function LpUsersPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [range, setRange] = useState<RangeType>('30d')
  const [temperature, setTemperature] = useState<Temperature>('')
  const [page, setPage] = useState(1)

  const query = new URLSearchParams({
    range,
    page: String(page),
    page_size: '20',
    ...(temperature ? { temperature } : {}),
  })

  const { data, isLoading } = useSWR<{
    success: boolean
    data: LpUserItem[]
    meta: { page: number; pageSize: number; totalCount: number }
  }>(`/api/services/${serviceId}/lp/users?${query}`, fetcher)

  const users = data?.data ?? []
  const meta = data?.meta

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">プロジェクト</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/lp`} className="hover:text-purple-600">LP</Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">ユーザー一覧</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">👥 LPユーザー一覧</h1>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setRange(opt.value as RangeType); setPage(1) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                range === opt.value ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => { setTemperature(''); setPage(1) }}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            temperature === '' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          すべて
        </button>
        <button
          onClick={() => { setTemperature('hot'); setPage(1) }}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            temperature === 'hot' ? 'bg-red-600 text-white border-red-600' : 'text-gray-600 border-gray-200 hover:bg-red-50'
          }`}
        >
          🔥 HOT
        </button>
        <button
          onClick={() => { setTemperature('cold'); setPage(1) }}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            temperature === 'cold' ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-200 hover:bg-blue-50'
          }`}
        >
          ❄️ COLD
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-7 h-7 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <span className="text-4xl mb-3">👥</span>
            <p className="text-sm">ユーザーデータがありません</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">ユーザー</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">温度</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">訪問数</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">インテントスコア</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">最終訪問</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.userId} className="hover:bg-purple-50/30 transition-colors group">
                  <td className="px-5 py-4">
                    <Link
                      href={`/projects/${projectId}/services/${serviceId}/lp/users/${u.userId}`}
                      className="font-mono text-xs text-gray-600 group-hover:text-purple-700 transition-colors"
                    >
                      {u.anonymousKey}
                    </Link>
                    <p className="text-xs text-gray-300 mt-0.5">
                      初回: {new Date(u.firstVisitedAt).toLocaleDateString('ja-JP')}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    {u.userTemperature === 'HOT' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-medium">
                        🔥 HOT
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-medium">
                        ❄️ COLD
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-gray-700 font-medium">{u.visitCount}回</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">{u.totalIntentScore}</span>
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${u.userTemperature === 'HOT' ? 'bg-red-400' : 'bg-blue-300'}`}
                          style={{ width: `${Math.min(100, u.totalIntentScore)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-gray-400 text-xs">
                    {new Date(u.lastVisitedAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/projects/${projectId}/services/${serviceId}/lp/users/${u.userId}`}
                      className="text-gray-300 group-hover:text-purple-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {meta && meta.totalCount > meta.pageSize && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-400">全 {meta.totalCount.toLocaleString()} 件</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              前へ
            </button>
            <span className="text-sm text-gray-500">{page} / {Math.ceil(meta.totalCount / meta.pageSize)}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= Math.ceil(meta.totalCount / meta.pageSize)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              次へ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
