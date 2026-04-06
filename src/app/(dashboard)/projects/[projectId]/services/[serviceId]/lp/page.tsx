'use client'

import { useState, use, useCallback } from 'react'
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

// ---------------------------------------------------------------------------
// SDK 埋め込みコードセクション
// ---------------------------------------------------------------------------
function EmbedCodeSection({ lpCode, apiBase, serviceId }: { lpCode: string; apiBase: string; serviceId: string }) {
  const [copied, setCopied] = useState<'snippet' | 'lpCode' | 'newKey' | null>(null)
  const [open, setOpen] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)

  const snippet = `<script src="${apiBase}/lp-sdk.js"></script>
<script>
  LpMA.init({
    apiBase: '${apiBase}/api/public/lp',
    apiKey: 'YOUR_API_KEY',  // サービス作成時に発行されたキー
    lpCode: '${lpCode}',
  });
</script>`

  const copy = useCallback((text: string, type: 'snippet' | 'lpCode') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    })
  }, [])

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
      >
        <span className="flex items-center gap-2">
          <span className="text-base">{'</>'}</span>
          SDK 埋め込み設定
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {/* LP コード */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">LP コード（lpCode）</p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg border border-gray-200 px-3 py-2">
              <code className="text-sm font-mono text-purple-700 flex-1">{lpCode}</code>
              <button
                onClick={() => copy(lpCode, 'lpCode')}
                className="text-gray-400 hover:text-purple-600 transition flex-shrink-0"
                title="コピー"
              >
                {copied === 'lpCode' ? (
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* API キー注意書き */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
            <p className="font-semibold mb-0.5">⚠️ API キー（apiKey）について</p>
            <p>API キーはサービス作成時に一度だけ表示されます。紛失した場合は下の「APIキーを再発行」から新しいキーを発行してください。</p>
          </div>

          {/* 埋め込みコード */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-gray-500">埋め込みコード（LP の {'</body>'} 直前に貼り付け）</p>
              <button
                onClick={() => copy(snippet, 'snippet')}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-purple-600 transition"
              >
                {copied === 'snippet' ? (
                  <><svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg><span className="text-green-600">コピーしました</span></>
                ) : (
                  <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg><span>コピー</span></>
                )}
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 rounded-xl text-xs p-4 overflow-x-auto leading-relaxed whitespace-pre">
              {snippet}
            </pre>
          </div>

          {/* API キー再発行 */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-red-500 mb-1">API キーを再発行</p>
            <p className="text-xs text-gray-400 mb-3">再発行すると既存キーは即座に無効になります。LP に埋め込み済みのコードも更新が必要です。</p>
            <button
              onClick={async () => {
                if (!confirm('APIキーを再発行しますか？\n既存のキーは即座に無効になります。')) return
                setRotating(true)
                setNewApiKey(null)
                try {
                  const res = await fetch(`/api/services/${serviceId}/rotate-key`, { method: 'POST' })
                  const json = await res.json()
                  if (json.api_key) {
                    setNewApiKey(json.api_key)
                  }
                } finally {
                  setRotating(false)
                }
              }}
              disabled={rotating}
              className="px-4 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
            >
              {rotating ? '発行中...' : 'APIキーを再発行する'}
            </button>

            {/* 新しいキーの表示（画面内にコピー可能な形で） */}
            {newApiKey && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-green-700 mb-2">✅ 新しい API キーが発行されました</p>
                <p className="text-xs text-green-600 mb-3">このキーは今後表示されません。必ずコピーして LP 側に設定してください。</p>
                <div className="flex items-center gap-2 bg-white rounded-lg border border-green-200 px-3 py-2">
                  <code className="text-sm font-mono text-green-800 flex-1 break-all">{newApiKey}</code>
                  <button
                    onClick={() => copy(newApiKey, 'newKey')}
                    className="text-green-500 hover:text-green-700 transition flex-shrink-0 ml-2"
                    title="コピー"
                  >
                    {copied === 'newKey' ? (
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
                {copied === 'newKey' && (
                  <p className="text-xs text-green-600 mt-1">コピーしました！</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
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
  const lpCode = (service?.type_config as Record<string, unknown> | null)?.lp_code as string | undefined
  const apiBase = typeof window !== 'undefined' ? window.location.origin : ''

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

      {/* SDK 埋め込み設定 */}
      {lpCode && <EmbedCodeSection lpCode={lpCode} apiBase={apiBase} serviceId={serviceId} />}

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
              { href: 'users', label: 'ユーザー一覧', icon: '👥', desc: 'HOT/COLDユーザーを確認', color: 'hover:bg-purple-50 group-hover:text-purple-700 group-hover:text-purple-400' },
              { href: 'sessions', label: 'セッション一覧', icon: '🕐', desc: '訪問セッションの詳細', color: 'hover:bg-purple-50 group-hover:text-purple-700 group-hover:text-purple-400' },
              { href: 'events', label: 'イベント管理', icon: '⚡', desc: 'イベントルールの設定', color: 'hover:bg-purple-50 group-hover:text-purple-700 group-hover:text-purple-400' },
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
            {/* 外部分析ツール */}
            <div className="border-t border-gray-100 pt-3 mt-3 space-y-2">
              <p className="text-xs font-medium text-gray-400 px-1">外部分析ツール</p>
              <Link
                href={`/projects/${projectId}/services/${serviceId}/lp/ga4`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 transition-colors group border border-dashed border-blue-200"
              >
                <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: '#4285F4' }}>G</span>
                <div>
                  <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700">GA4 分析</p>
                  <p className="text-xs text-gray-400">トラフィック・コンバージョン・ユーザー行動</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href={`/projects/${projectId}/services/${serviceId}/lp/clarity`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-cyan-50 transition-colors group border border-dashed border-cyan-200"
              >
                <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">C</span>
                <div>
                  <p className="text-sm font-medium text-gray-900 group-hover:text-cyan-700">Clarity 分析</p>
                  <p className="text-xs text-gray-400">ユーザー行動・問題行動の可視化</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-cyan-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
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
