'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type RangeType = 'all' | '30d' | '7d' | 'today'

const RANGE_OPTIONS: { value: RangeType; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '7日間' },
  { value: '30d', label: '30日間' },
  { value: 'all', label: '全期間' },
]

interface MetricItem {
  metricName: string
  value: number | null
  sourceType: string
}

interface RankingItem {
  rank_no: number
  item_key: string
  item_label: string
  count_value: number
  source_type: string
}

interface LpSummaryData {
  range: RangeType
  metrics: MetricItem[]
  rankings: {
    event: RankingItem[]
    page: RankingItem[]
    referrer: RankingItem[]
    exit: RankingItem[]
  }
  fetchedAt: string
  dataSource: string
}

const METRIC_LABELS: Record<string, { label: string; unit: string; icon: string }> = {
  session_count: { label: 'セッション数', unit: '件', icon: '📊' },
  user_count: { label: 'ユーザー数', unit: '人', icon: '👥' },
  avg_stay_seconds: { label: '平均滞在時間', unit: '秒', icon: '⏱️' },
  hot_session_rate: { label: 'HOTセッション率', unit: '%', icon: '🔥' },
}

function formatValue(metricName: string, value: number | null): string {
  if (value === null) return '-'
  if (metricName === 'avg_stay_seconds') {
    if (value >= 60) return `${Math.floor(value / 60)}分${Math.round(value % 60)}秒`
    return `${value}秒`
  }
  return value.toLocaleString()
}

export default function LpDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [range, setRange] = useState<RangeType>('30d')

  const { data: serviceData } = useSWR<{ success: boolean; data: Record<string, unknown> }>(
    `/api/services/${serviceId}`,
    fetcher
  )

  const { data: summaryData, isLoading } = useSWR<{ success: boolean; data: LpSummaryData }>(
    `/api/services/${serviceId}/lp/summary?range=${range}`,
    fetcher
  )

  const service = serviceData?.data
  const summary = summaryData?.data

  const metricOrder = ['session_count', 'user_count', 'avg_stay_seconds', 'hot_session_rate']
  const metricsMap = new Map((summary?.metrics ?? []).map(m => [m.metricName, m]))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6 flex-wrap">
        <Link href="/clients" className="hover:text-purple-600">クライアント一覧</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">プロジェクト</Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">{service?.service_name as string ?? 'LP'}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">🎯</span>
            <h1 className="text-2xl font-bold text-gray-900">{service?.service_name as string ?? 'LP ダッシュボード'}</h1>
          </div>
          <p className="text-sm text-gray-400">LP計測・マーケティングオートメーション</p>
        </div>

        {/* Range Selector */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                range === opt.value
                  ? 'bg-white text-purple-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {metricOrder.map(key => (
            <div key={key} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
              <div className="h-8 bg-gray-200 rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {metricOrder.map(key => {
            const meta = METRIC_LABELS[key] ?? { label: key, unit: '', icon: '📈' }
            const metric = metricsMap.get(key)
            return (
              <div key={key} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span>{meta.icon}</span>
                  <p className="text-xs font-medium text-gray-500">{meta.label}</p>
                </div>
                <p className="text-2xl font-bold text-gray-900">
                  {formatValue(key, metric?.value ?? null)}
                  {metric?.value !== null && metric?.value !== undefined && (
                    <span className="text-sm font-normal text-gray-400 ml-1">{meta.unit}</span>
                  )}
                </p>
                <p className="text-xs text-gray-300 mt-1">{meta.unit && `ソース: ${metric?.sourceType ?? 'MA'}`}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Rankings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* イベントランキング */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 text-sm">🏆 イベント発火ランキング</h3>
            <Link
              href={`/projects/${projectId}/services/${serviceId}/lp/events`}
              className="text-xs text-purple-600 hover:underline"
            >
              イベント管理
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : (summary?.rankings.event ?? []).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">データがありません</p>
          ) : (
            <div className="space-y-2">
              {(summary?.rankings.event ?? []).slice(0, 5).map(item => (
                <div key={item.item_key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs flex items-center justify-center font-bold flex-shrink-0">
                      {item.rank_no}
                    </span>
                    <span className="text-gray-700 truncate max-w-[180px]">{item.item_label}</span>
                  </div>
                  <span className="font-semibold text-gray-900 flex-shrink-0">{item.count_value.toLocaleString()}回</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 流入元ランキング */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 text-sm mb-4">🔗 流入元ランキング</h3>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : (summary?.rankings.referrer ?? []).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">データがありません</p>
          ) : (
            <div className="space-y-2">
              {(summary?.rankings.referrer ?? []).slice(0, 5).map(item => (
                <div key={item.item_key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold flex-shrink-0">
                      {item.rank_no}
                    </span>
                    <span className="text-gray-700 truncate max-w-[180px]">{item.item_label}</span>
                  </div>
                  <span className="font-semibold text-gray-900 flex-shrink-0">{item.count_value.toLocaleString()}件</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ページ閲覧ランキング */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 text-sm">📄 ページ閲覧ランキング</h3>
            <Link
              href={`/projects/${projectId}/services/${serviceId}/lp/users`}
              className="text-xs text-purple-600 hover:underline"
            >
              ユーザー一覧
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : (summary?.rankings.page ?? []).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">データがありません</p>
          ) : (
            <div className="space-y-2">
              {(summary?.rankings.page ?? []).slice(0, 5).map(item => (
                <div key={item.item_key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 text-xs flex items-center justify-center font-bold flex-shrink-0">
                      {item.rank_no}
                    </span>
                    <span className="text-gray-600 truncate max-w-[180px] text-xs">{item.item_label || item.item_key}</span>
                  </div>
                  <span className="font-semibold text-gray-900 flex-shrink-0">{item.count_value.toLocaleString()}PV</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* クイックリンク */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 text-sm mb-4">🔧 管理メニュー</h3>
          <div className="space-y-2">
            {[
              { href: 'users', label: 'ユーザー一覧', icon: '👥', desc: 'HOT/COLDユーザーを確認' },
              { href: 'sessions', label: 'セッション一覧', icon: '🕐', desc: '訪問セッションの詳細' },
              { href: 'events', label: 'イベント管理', icon: '⚡', desc: 'イベントルールの設定' },
            ].map(item => (
              <Link
                key={item.href}
                href={`/projects/${projectId}/services/${serviceId}/lp/${item.href}`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-purple-50 transition-colors group"
              >
                <span className="text-xl">{item.icon}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900 group-hover:text-purple-700">{item.label}</p>
                  <p className="text-xs text-gray-400">{item.desc}</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-purple-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {summary && (
        <p className="text-xs text-gray-300 text-right mt-4">
          最終更新: {new Date(summary.fetchedAt).toLocaleString('ja-JP')}
          {summary.dataSource === 'realtime' && ' (リアルタイム集計)'}
        </p>
      )}
    </div>
  )
}
