'use client'

import { use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface SessionItem {
  sessionId: string
  startedAt: string
  endedAt: string | null
  durationSeconds: number
  sessionIntentScore: number
  referrerSource: string | null
  landingPageUrl: string | null
  exitPageUrl: string | null
}

interface LpUserDetail {
  userId: string
  anonymousKey: string
  firstVisitedAt: string
  lastVisitedAt: string
  visitCount: number
  totalIntentScore: number
  userTemperature: string
  userAgent: string | null
  /** フォーム等で送信されたプロフィール（キーは LP 側で任意） */
  formProfile?: Record<string, unknown>
  sessions: SessionItem[]
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '-'
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}時間${Math.floor((seconds % 3600) / 60)}分`
  if (seconds >= 60) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
  return `${seconds}秒`
}

export default function LpUserDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string; userId: string }>
}) {
  const { projectId, serviceId, userId } = use(params)

  const { data, isLoading } = useSWR<{ success: boolean; data: LpUserDetail }>(
    `/api/services/${serviceId}/lp/users/${userId}`,
    fetcher
  )

  const user = data?.data

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          ユーザーが見つかりません
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href={`/projects/${projectId}/services/${serviceId}/lp`} className="hover:text-purple-600">LP</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/lp/users`} className="hover:text-purple-600">ユーザー一覧</Link>
        <span>›</span>
        <span className="text-gray-700 font-medium font-mono text-xs">{user.anonymousKey}</span>
      </nav>

      {/* User Info Card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-2xl ${
              user.userTemperature === 'HOT' ? 'bg-red-50' : 'bg-blue-50'
            }`}>
              {user.userTemperature === 'HOT' ? '🔥' : '❄️'}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  user.userTemperature === 'HOT'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-blue-100 text-blue-700'
                }`}>
                  {user.userTemperature?.toUpperCase()}
                </span>
              </div>
              <p className="font-mono text-sm text-gray-600">{user.anonymousKey}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                初回訪問: {new Date(user.firstVisitedAt).toLocaleString('ja-JP')}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-gray-900">{user.totalIntentScore}</p>
            <p className="text-xs text-gray-400 mt-0.5">累計インテントスコア</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-100">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{user.visitCount}</p>
            <p className="text-xs text-gray-400 mt-1">訪問回数</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{user.sessions.length}</p>
            <p className="text-xs text-gray-400 mt-1">セッション数</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-700">
              {new Date(user.lastVisitedAt).toLocaleDateString('ja-JP')}
            </p>
            <p className="text-xs text-gray-400 mt-1">最終訪問日</p>
          </div>
        </div>

        {user.formProfile && Object.keys(user.formProfile).length > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-2">フォーム・送信プロフィール</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {Object.entries(user.formProfile).map(([key, val]) => (
                <div key={key} className="flex flex-col bg-gray-50 rounded-lg px-3 py-2">
                  <dt className="text-xs text-gray-400 font-mono break-all">{key}</dt>
                  <dd className="text-gray-800 font-medium mt-0.5 break-words">
                    {val === null || val === undefined ? '—' : String(val)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {/* Sessions */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">
        セッション履歴
        <span className="ml-2 text-sm font-normal text-gray-400">{user.sessions.length}件</span>
      </h2>

      {user.sessions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-12 text-center text-gray-400">
          <p className="text-sm">セッション履歴がありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {user.sessions.map((session, idx) => (
            <Link
              key={session.sessionId}
              href={`/projects/${projectId}/services/${serviceId}/lp/sessions/${session.sessionId}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-purple-200 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs flex items-center justify-center font-bold flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900 group-hover:text-purple-700 transition-colors">
                      {new Date(session.startedAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {session.referrerSource && (
                        <span className="text-xs text-gray-400">流入: {session.referrerSource}</span>
                      )}
                      <span className="text-xs text-gray-400">滞在: {formatDuration(session.durationSeconds)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">{session.sessionIntentScore}</p>
                    <p className="text-xs text-gray-400">スコア</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
