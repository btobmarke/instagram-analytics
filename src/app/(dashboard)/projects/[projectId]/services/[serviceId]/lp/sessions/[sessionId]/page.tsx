'use client'

import { use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { formatDeviceCategoryJa } from '@/lib/lp-device-category'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type TimelineItem = {
  type: 'page_view' | 'event'
  occurredAt: string
  pageUrl?: string
  pageTitle?: string
  scrollPercentMax?: number
  staySeconds?: number
  eventId?: string
  eventName?: string
  intentScore?: number
  scrollPercent?: number
  meta?: Record<string, unknown>
}

interface SessionDetail {
  sessionId: string
  userId: string
  startedAt: string
  endedAt: string | null
  durationSeconds: number
  sessionIntentScore: number
  interactionCount: number
  referrerSource: string | null
  landingPageUrl: string | null
  exitPageUrl: string | null
  userAgent: string | null
  deviceCategory: string
  pageViewCount: number
  eventCount: number
  timeline: TimelineItem[]
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '-'
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}時間${Math.floor((seconds % 3600) / 60)}分`
  if (seconds >= 60) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
  return `${seconds}秒`
}

export default function LpSessionDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string; sessionId: string }>
}) {
  const { projectId, serviceId, sessionId } = use(params)

  const { data, isLoading } = useSWR<{ success: boolean; data: SessionDetail }>(
    `/api/services/${serviceId}/lp/sessions/${sessionId}`,
    fetcher
  )

  const session = data?.data

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          セッションが見つかりません
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6 flex-wrap">
        <Link href={`/projects/${projectId}/services/${serviceId}/lp`} className="hover:text-purple-600">LP</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/lp/users/${session.userId}`} className="hover:text-purple-600">
          ユーザー詳細
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">セッション詳細</span>
      </nav>

      {/* Session Info */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h1 className="text-xl font-bold text-gray-900 mb-4">🕐 セッション詳細</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">開始時刻</p>
            <p className="text-sm font-semibold text-gray-900">
              {new Date(session.startedAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">滞在時間</p>
            <p className="text-sm font-semibold text-gray-900">{formatDuration(session.durationSeconds)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">インテントスコア</p>
            <p className="text-2xl font-bold text-purple-700">{session.sessionIntentScore}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">インタラクション</p>
            <p className="text-sm font-semibold text-gray-900">{session.interactionCount}回</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-100">
          <span className="text-xs font-semibold text-gray-500">端末（セッション開始時）</span>
          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
            {formatDeviceCategoryJa(session.deviceCategory)}
          </span>
        </div>
        {session.userAgent && (
          <p className="text-xs text-gray-400 font-mono break-all mt-2" title={session.userAgent}>
            UA: {session.userAgent.length > 200 ? `${session.userAgent.slice(0, 200)}…` : session.userAgent}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4 border-t border-gray-100">
          {session.referrerSource && (
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-400">流入元</p>
              <p className="text-sm font-medium text-gray-700 mt-0.5">{session.referrerSource}</p>
            </div>
          )}
          {session.landingPageUrl && (
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-400">ランディングURL</p>
              <p className="text-xs font-medium text-gray-700 mt-0.5 truncate">{session.landingPageUrl}</p>
            </div>
          )}
          {session.exitPageUrl && (
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-400">離脱URL</p>
              <p className="text-xs font-medium text-gray-700 mt-0.5 truncate">{session.exitPageUrl}</p>
            </div>
          )}
        </div>

        <div className="flex gap-4 mt-4">
          <span className="text-sm text-gray-500">ページビュー: <strong>{session.pageViewCount}</strong>件</span>
          <span className="text-sm text-gray-500">イベント: <strong>{session.eventCount}</strong>件</span>
        </div>
      </div>

      {/* Timeline */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">行動タイムライン</h2>

      {session.timeline.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-10 text-center text-gray-400">
          <p className="text-sm">タイムラインデータがありません</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-200" />
          <div className="space-y-3">
            {session.timeline.map((item, idx) => (
              <div key={idx} className="relative flex gap-4">
                <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                  item.type === 'event'
                    ? 'bg-purple-100 border-2 border-purple-300'
                    : 'bg-gray-100 border-2 border-gray-200'
                }`}>
                  <span className="text-sm">
                    {item.type === 'event' ? '⚡' : '📄'}
                  </span>
                </div>
                <div className="flex-1 bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      {item.type === 'page_view' ? (
                        <>
                          <p className="text-sm font-medium text-gray-900">
                            {item.pageTitle ?? 'ページビュー'}
                          </p>
                          {item.pageUrl && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{item.pageUrl}</p>
                          )}
                          <div className="flex gap-3 mt-1">
                            {item.scrollPercentMax !== undefined && (
                              <span className="text-xs text-gray-500">
                                スクロール: {item.scrollPercentMax}%
                              </span>
                            )}
                            {item.staySeconds !== undefined && item.staySeconds > 0 && (
                              <span className="text-xs text-gray-500">
                                滞在: {item.staySeconds}秒
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-gray-900">
                            {item.eventName ?? item.eventId}
                          </p>
                          {item.eventId && item.eventName && (
                            <p className="text-xs text-gray-400 mt-0.5 font-mono">{item.eventId}</p>
                          )}
                          {item.pageUrl && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{item.pageUrl}</p>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-start gap-3 flex-shrink-0">
                      {item.type === 'event' && item.intentScore !== undefined && item.intentScore > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold">
                          +{item.intentScore}
                        </span>
                      )}
                      <p className="text-xs text-gray-300">
                        {new Date(item.occurredAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
