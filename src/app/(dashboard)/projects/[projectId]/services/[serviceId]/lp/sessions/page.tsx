'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type RangeType = 'all' | '30d' | '7d' | 'today'

const RANGE_OPTIONS = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '7日間' },
  { value: '30d', label: '30日間' },
  { value: 'all', label: '全期間' },
]

interface SessionItem {
  sessionId: string
  userId: string
  startedAt: string
  endedAt: string | null
  durationSeconds: number
  sessionIntentScore: number
  interactionCount: number
  referrerSource: string | null
  landingPageUrl: string | null
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '-'
  if (seconds >= 60) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
  return `${seconds}秒`
}

export default function LpSessionsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [range, setRange] = useState<RangeType>('30d')
  const [page, setPage] = useState(1)

  const query = new URLSearchParams({ range, page: String(page), page_size: '20' })
  const { data, isLoading } = useSWR<{
    success: boolean
    data: SessionItem[]
    meta: { page: number; pageSize: number; totalCount: number }
  }>(`/api/services/${serviceId}/lp/sessions?${query}`, fetcher)

  const sessions = data?.data ?? []
  const meta = data?.meta

  return (
    <div className="p-6 w-full max-w-none min-w-0">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href={`/projects/${projectId}/services/${serviceId}/lp`} className="hover:text-purple-600">LP</Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">セッション一覧</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">🕐 セッション一覧</h1>
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

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-7 h-7 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <span className="text-4xl mb-3">🕐</span>
            <p className="text-sm">セッションデータがありません</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">開始時刻</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">滞在時間</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">スコア</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">操作数</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">流入元</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sessions.map(s => (
                <tr key={s.sessionId} className="hover:bg-purple-50/30 transition-colors group">
                  <td className="px-5 py-4">
                    <Link
                      href={`/projects/${projectId}/services/${serviceId}/lp/sessions/${s.sessionId}`}
                      className="font-medium text-gray-900 group-hover:text-purple-700 transition-colors text-sm"
                    >
                      {new Date(s.startedAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Link>
                    {!s.endedAt && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">アクティブ</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-gray-600">{formatDuration(s.durationSeconds)}</td>
                  <td className="px-5 py-4">
                    <span className={`font-bold ${s.sessionIntentScore > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                      {s.sessionIntentScore}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-gray-600">{s.interactionCount}回</td>
                  <td className="px-5 py-4 text-gray-400 text-xs">{s.referrerSource ?? 'direct'}</td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/projects/${projectId}/services/${serviceId}/lp/sessions/${s.sessionId}`}
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
