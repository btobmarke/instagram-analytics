'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, use } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { IgMedia, AiAnalysisResult } from '@/types'
import { MarkdownRenderer, BlinkingCursor } from '@/components/ai/MarkdownRenderer'
import { PostMediaSlider } from '@/components/posts/PostMediaSlider'

interface PostDetailData {
  post: IgMedia
  latest_insights: Record<string, number | null>
  time_series: Record<string, Array<{ snapshot_at: string; value: number | null }>>
  latest_ai_analysis: AiAnalysisResult | null
}

const METRIC_LABELS: Record<string, string> = {
  reach: 'リーチ',
  impressions: 'インプレッション',
  views: '表示回数',
  likes: 'いいね',
  comments: 'コメント',
  saved: '保存',
  shares: 'シェア',
  video_views: '動画再生数',
  total_interactions: '総エンゲージメント',
  profile_visits: 'プロフィール訪問',
  follows: 'フォロー',
  taps_forward: '次へタップ',
  taps_back: '前へタップ',
  exits: '離脱',
  replies: '返信',
}

const CHART_COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

function metricLabel(metric: string): string {
  if (METRIC_LABELS[metric]) return METRIC_LABELS[metric]
  if (metric.startsWith('profile_activity_')) {
    const tail = metric.slice('profile_activity_'.length)
    return `プロフィール行動（${tail}）`
  }
  if (metric.startsWith('navigation_')) {
    const tail = metric.slice('navigation_'.length)
    return `ナビ（${tail}）`
  }
  return metric
}

export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const accountId = searchParams.get('account')

  const [data, setData] = useState<PostDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedMetrics, setSelectedMetrics] = useState(['reach', 'likes', 'saved'])
  const [analyzing, setAnalyzing] = useState(false)
  const [streamText, setStreamText] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/posts/${id}`)
      .then(r => r.json())
      .then(json => { setData(json.data); setLoading(false) })
  }, [id])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setStreamText('')
    const res = await fetch(`/api/posts/${id}/analysis`, { method: 'POST' })
    if (!res.body) { setAnalyzing(false); return }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      setStreamText(text)
    }
    setAnalyzing(false)
    // Refresh to get saved analysis
    const refreshed = await fetch(`/api/posts/${id}`)
    const json = await refreshed.json()
    setData(json.data)
  }

  if (loading) return <Loader />
  if (!data) return <div className="text-center text-gray-500 py-16">投稿が見つかりません</div>

  const { post, latest_insights, time_series, latest_ai_analysis } = data

  const baseMetricOrder = [
    'views',
    'reach',
    'likes',
    'comments',
    'saved',
    'shares',
    'total_interactions',
    'profile_visits',
    'follows',
    'taps_forward',
    'taps_back',
    'exits',
    'replies',
    'impressions',
    'video_views',
  ] as const

  const extraInsightKeys = Object.keys(latest_insights ?? {}).filter(k => {
    if (baseMetricOrder.includes(k as (typeof baseMetricOrder)[number])) return false
    if (k.startsWith('profile_activity_')) return true
    if (k.startsWith('navigation_')) return true
    return false
  })

  const metricKeys = [
    ...baseMetricOrder.filter(k => k in (latest_insights ?? {})),
    ...extraInsightKeys.sort(),
  ]

  // Build chart data
  const allSnapshots = new Set<string>()
  for (const m of selectedMetrics) {
    for (const s of time_series[m] ?? []) allSnapshots.add(s.snapshot_at)
  }
  const sortedSnapshots = Array.from(allSnapshots).sort()
  const chartData = sortedSnapshots.slice(-24).map(snap => {
    const point: Record<string, string | number | null> = {
      time: new Date(snap).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }
    for (const m of selectedMetrics) {
      const found = time_series[m]?.find(s => s.snapshot_at === snap)
      point[m] = found?.value ?? null
    }
    return point
  })

  const egRate = latest_insights.reach && latest_insights.reach > 0 && latest_insights.total_interactions != null
    ? ((latest_insights.total_interactions / latest_insights.reach) * 100).toFixed(2) : null
  const saveRate = latest_insights.reach && latest_insights.reach > 0 && latest_insights.saved != null
    ? ((latest_insights.saved / latest_insights.reach) * 100).toFixed(2) : null

  const children = post.children_json as Array<{ media_url?: string; thumbnail_url?: string }> | null

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href={`/posts?account=${accountId}`} className="hover:text-purple-600">投稿一覧</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">投稿詳細</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Post Info */}
        <div className="md:col-span-1 space-y-4">
          {/* Thumbnail / Carousel */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="p-3">
              <PostMediaSlider
                mediaUrl={post.media_url}
                thumbnailUrl={post.thumbnail_url}
                children={children}
              />
            </div>
            <div className="px-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
                  {post.media_product_type ?? post.media_type}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(post.posted_at).toLocaleString('ja-JP')}
                </span>
              </div>
              {post.caption && (
                <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">{post.caption}</p>
              )}
              {post.permalink && (
                <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-purple-600 hover:underline mt-3 block">
                  Instagramで見る →
                </a>
              )}
            </div>
          </div>

          {/* Key Metrics */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">主要指標</h3>
            <div className="grid grid-cols-2 gap-3">
              {metricKeys.map((code) => {
                const label = metricLabel(code)
                const val = latest_insights[code]
                return (
                  <div key={code} className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="text-lg font-bold text-gray-900">{val?.toLocaleString() ?? '—'}</p>
                  </div>
                )
              })}
              <div className="bg-purple-50 rounded-xl p-3">
                <p className="text-xs text-purple-600">エンゲージメント率</p>
                <p className="text-lg font-bold text-purple-700">{egRate ? `${egRate}%` : '—'}</p>
              </div>
              <div className="bg-pink-50 rounded-xl p-3">
                <p className="text-xs text-pink-600">保存率</p>
                <p className="text-lg font-bold text-pink-700">{saveRate ? `${saveRate}%` : '—'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Chart + AI */}
        <div className="md:col-span-2 space-y-4">
          {/* Time Series Chart */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">指標の推移</h3>
              <div className="flex flex-wrap gap-2">
                {metricKeys.map((m, i) => (
                  <button
                    key={m}
                    onClick={() => setSelectedMetrics(prev =>
                      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
                    )}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${
                      selectedMetrics.includes(m)
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                    style={selectedMetrics.includes(m) ? { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] } : {}}
                  >
                    {metricLabel(m)}
                  </button>
                ))}
              </div>
            </div>

            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Legend />
                  {selectedMetrics.map((m, i) => (
                    <Line
                      key={m}
                      type="monotone"
                      dataKey={m}
                      name={metricLabel(m)}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-60 flex items-center justify-center text-gray-400 text-sm">
                時系列データがまだありません（バッチ収集後に表示されます）
              </div>
            )}
          </div>

          {/* AI Analysis */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">AI分析</h3>
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition disabled:opacity-60"
              >
                {analyzing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    分析中...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    AI分析を実行
                  </>
                )}
              </button>
            </div>

            {streamText !== null ? (
              <div className="bg-gray-50 rounded-xl p-4">
                {streamText ? (
                  <div className="relative">
                    <MarkdownRenderer content={streamText} />
                    {analyzing && <BlinkingCursor />}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 animate-pulse">分析中...</p>
                )}
              </div>
            ) : latest_ai_analysis ? (
              <div>
                <p className="text-xs text-gray-400 mb-3">
                  {new Date(latest_ai_analysis.created_at).toLocaleString('ja-JP')} 実行
                </p>
                <div className="bg-gray-50 rounded-xl p-4">
                  <MarkdownRenderer content={latest_ai_analysis.analysis_result} />
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-xl p-8 text-center text-gray-400 text-sm">
                「AI分析を実行」ボタンを押すと、この投稿の詳細分析を行います
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Loader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
    </div>
  )
}
