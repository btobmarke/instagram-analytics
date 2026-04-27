'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, use, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { IgMedia, AiAnalysisResult, IgMediaManualInsightExtra } from '@/types'
import { MarkdownRenderer, BlinkingCursor } from '@/components/ai/MarkdownRenderer'
import { PostMediaSlider } from '@/components/posts/PostMediaSlider'
import {
  buildPostInsightChartRows,
  milestoneCumulativeSummary,
  INSIGHT_PHASE_OPTIONS,
  INSIGHT_PHASE_OPTIONS_STORY,
  INSIGHT_MILESTONES,
  INSIGHT_MILESTONES_STORY,
  type InsightPhaseId,
  type InsightValueMode,
  type MilestoneDiffRow,
} from '@/lib/instagram/post-insight-chart'
import {
  defaultChartMetricsForPost,
  isStoryMedia,
  milestoneMetricsForPost,
  overlayMetricChoicesForPost,
} from '@/lib/instagram/post-display-mode'
import { postMetaRows } from '@/lib/instagram/post-meta'
import { ManualInsightExtraModal, ManualInsightExtraHistoryTable } from '@/components/posts/ManualInsightExtraModal'

type SimilarPost = {
  id: string
  posted_at: string
  thumbnail_url: string | null
  caption: string | null
  media_product_type: string | null
  media_type: string
}

type OverlayApiResponse = {
  metric: string
  maxHours: number
  overlayRows: Array<Record<string, string | number | null>>
  diffTables: Array<{ peerId: string; peerLabel: string; rows: MilestoneDiffRow[] }>
  posts: Array<{ id: string; label: string; posted_at: string }>
  is_story?: boolean
}

interface PostDetailData {
  post: IgMedia
  latest_insights: Record<string, number | null>
  time_series: Record<string, Array<{ snapshot_at: string; value: number | null }>>
  latest_ai_analysis: AiAnalysisResult | null
  manual_insight_extra?: IgMediaManualInsightExtra[]
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
  const returnTo = searchParams.get('returnTo')

  const [data, setData] = useState<PostDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['reach', 'likes', 'saved'])
  const [insightPhase, setInsightPhase] = useState<InsightPhaseId>('0-72h')
  const [insightValueMode, setInsightValueMode] = useState<InsightValueMode>('cumulative')
  const [analyzing, setAnalyzing] = useState(false)
  const [streamText, setStreamText] = useState<string | null>(null)
  const [similarPosts, setSimilarPosts] = useState<SimilarPost[]>([])
  const [selectedPeers, setSelectedPeers] = useState<string[]>([])
  const [overlayMetric, setOverlayMetric] = useState('reach')
  const [overlayData, setOverlayData] = useState<OverlayApiResponse | null>(null)
  const [overlayLoading, setOverlayLoading] = useState(false)
  const [manualModalOpen, setManualModalOpen] = useState(false)

  useEffect(() => {
    fetch(`/api/posts/${id}`)
      .then(r => r.json())
      .then(json => {
        const d = json.data as PostDetailData | null
        if (d && !Array.isArray(d.manual_insight_extra)) d.manual_insight_extra = []
        setData(d)
        setLoading(false)
        if (d?.post) {
          const story = isStoryMedia(d.post)
          const defaults = defaultChartMetricsForPost(d.post).filter(m => m in (d.latest_insights ?? {}))
          setSelectedMetrics(defaults.length > 0 ? defaults : defaultChartMetricsForPost(d.post))
          setInsightPhase(story ? '0-24h' : '0-72h')
          setOverlayMetric('reach')
          setSelectedPeers([])
        }
      })
  }, [id])

  useEffect(() => {
    fetch(`/api/posts/${id}/similar?limit=16`)
      .then(r => r.json())
      .then(j => setSimilarPosts(Array.isArray(j.posts) ? j.posts : []))
      .catch(() => setSimilarPosts([]))
  }, [id])

  useEffect(() => {
    if (selectedPeers.length === 0) {
      setOverlayData(null)
      return
    }
    setOverlayLoading(true)
    const story = data?.post ? isStoryMedia(data.post) : false
    const q = new URLSearchParams({
      peerIds: selectedPeers.join(','),
      metric: overlayMetric,
      maxHours: story ? '24' : '72',
    })
    fetch(`/api/posts/${id}/overlay?${q}`)
      .then(r => r.json())
      .then((j: OverlayApiResponse) => {
        if (j.overlayRows && j.posts) setOverlayData(j)
        else setOverlayData(null)
      })
      .catch(() => setOverlayData(null))
      .finally(() => setOverlayLoading(false))
  }, [id, selectedPeers, overlayMetric, data?.post])

  const isStory = Boolean(data?.post && isStoryMedia(data.post))
  const phaseOptions = isStory ? INSIGHT_PHASE_OPTIONS_STORY : INSIGHT_PHASE_OPTIONS
  const milestoneDefs = isStory ? INSIGHT_MILESTONES_STORY : INSIGHT_MILESTONES

  useEffect(() => {
    if (!data?.post || !isStoryMedia(data.post)) return
    const allowed = new Set(INSIGHT_PHASE_OPTIONS_STORY.map(o => o.id))
    if (!allowed.has(insightPhase)) setInsightPhase('0-24h')
  }, [data?.post, insightPhase])

  const metricKeys = useMemo(() => {
    if (!data?.latest_insights) return []
    const latest_insights = data.latest_insights
    const feedOrder = [
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
    const storyOrder = [
      'views',
      'reach',
      'taps_forward',
      'taps_back',
      'exits',
      'replies',
      'likes',
      'comments',
      'saved',
      'shares',
      'total_interactions',
      'profile_visits',
      'follows',
      'impressions',
      'video_views',
    ] as const
    const baseMetricOrder = isStoryMedia(data.post) ? storyOrder : feedOrder
    const baseSet = new Set<string>(baseMetricOrder as unknown as string[])
    const extraInsightKeys = Object.keys(latest_insights).filter(k => {
      if (baseSet.has(k)) return false
      if (k.startsWith('profile_activity_')) return true
      if (k.startsWith('navigation_')) return true
      return false
    })
    return [
      ...baseMetricOrder.filter(k => k in latest_insights),
      ...extraInsightKeys.sort(),
    ]
  }, [data])

  const milestoneMetrics = useMemo(() => {
    if (!data?.post) return []
    return milestoneMetricsForPost(data.post, metricKeys)
  }, [data?.post, metricKeys])

  const milestoneSummary = useMemo(() => {
    if (!data) {
      return {
        '6h': {},
        '24h': {},
        '72h': {},
        '7d': {},
      } as ReturnType<typeof milestoneCumulativeSummary>
    }
    return milestoneCumulativeSummary(
      data.post.posted_at,
      data.time_series,
      milestoneMetrics,
      milestoneDefs
    )
  }, [data, milestoneMetrics, milestoneDefs])

  const chartData = useMemo(() => {
    if (!data) return []
    return buildPostInsightChartRows({
      postedAtIso: data.post.posted_at,
      timeSeries: data.time_series,
      metrics: selectedMetrics.filter(m => metricKeys.includes(m)),
      phase: insightPhase,
      mode: insightValueMode,
    })
  }, [data, selectedMetrics, metricKeys, insightPhase, insightValueMode])

  const togglePeer = (peerId: string) => {
    setSelectedPeers(prev => {
      if (prev.includes(peerId)) return prev.filter(x => x !== peerId)
      if (prev.length >= 2) return [prev[0], peerId]
      return [...prev, peerId]
    })
  }

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setStreamText('')
    const res = await fetch(`/api/posts/${id}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_ids: selectedPeers }),
    })
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
  const manualInsightRows = data.manual_insight_extra ?? []
  const latestManualInsight = manualInsightRows[0]

  const egRate =
    !isStory &&
    latest_insights.reach &&
    latest_insights.reach > 0 &&
    latest_insights.total_interactions != null
      ? ((latest_insights.total_interactions / latest_insights.reach) * 100).toFixed(2)
      : null
  const saveRate =
    !isStory &&
    latest_insights.reach &&
    latest_insights.reach > 0 &&
    latest_insights.saved != null
      ? ((latest_insights.saved / latest_insights.reach) * 100).toFixed(2)
      : null

  const children =
    (post.children_json as Array<{ media_url?: string; thumbnail_url?: string }> | null)?.map((c) => ({
      mediaUrl: c.media_url,
      thumbnailUrl: c.thumbnail_url,
    })) ?? null

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link
          href={
            returnTo && returnTo.startsWith('/')
              ? returnTo
              : `/posts?account=${accountId ?? ''}${isStory ? '&mode=story' : '&mode=feed'}`
          }
          className="hover:text-purple-600"
        >
          投稿一覧
        </Link>
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

          {/* メタ情報（他要因の整理用） */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">投稿メタ</h3>
            <dl className="space-y-2 text-xs">
              {postMetaRows(post).map(row => (
                <div key={row.label} className="flex justify-between gap-2">
                  <dt className="text-gray-500 shrink-0">{row.label}</dt>
                  <dd className="text-gray-800 text-right break-all">{row.value || '—'}</dd>
                </div>
              ))}
            </dl>
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
              {!isStory && (
                <>
                  <div className="bg-purple-50 rounded-xl p-3">
                    <p className="text-xs text-purple-600">エンゲージメント率</p>
                    <p className="text-lg font-bold text-purple-700">{egRate ? `${egRate}%` : '—'}</p>
                  </div>
                  <div className="bg-pink-50 rounded-xl p-3">
                    <p className="text-xs text-pink-600">保存率</p>
                    <p className="text-lg font-bold text-pink-700">{saveRate ? `${saveRate}%` : '—'}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {!isStory && (
            <div className="bg-white rounded-2xl border border-gray-200 border-l-[3px] border-l-purple-500 shadow-sm overflow-hidden">
              <div className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900">手入力インサイト</h3>
                    <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
                      Graph API に無い内訳（ビューのフォロワー比率、閲覧の場所、いいねしたユーザー名など）をこの投稿用に残します。保存のたびに履歴が1行増えます。
                    </p>
                    {manualInsightRows.length > 0 && latestManualInsight ? (
                      <p className="text-xs text-gray-500 mt-2">
                        登録 <span className="font-semibold text-gray-800">{manualInsightRows.length}</span> 件
                        <span className="mx-1.5 text-gray-300">·</span>
                        最新 {new Date(latestManualInsight.recorded_at).toLocaleString('ja-JP')}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-2">まだ登録がありません。</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualModalOpen(true)}
                    className="shrink-0 inline-flex items-center justify-center w-full sm:w-auto text-sm font-semibold px-4 py-2.5 rounded-xl bg-purple-600 text-white hover:bg-purple-700 shadow-sm"
                  >
                    内訳を追加
                  </button>
                </div>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <ManualInsightExtraHistoryTable rows={manualInsightRows} emphasizeLatest />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Chart + AI */}
        <div className="md:col-span-2 space-y-4">
          {/* Time Series Chart */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">指標の推移</h3>
                <p className="text-xs text-gray-500 mt-1">
                  横軸は<strong>投稿公開からの経過</strong>です。区間で初速〜後半を切り替え、累積／増分で見方を変えられます。
                  {isStory && (
                    <span className="block mt-1 text-pink-700/90">
                      ストーリーは公開から約24時間で API 上から消えるため、長期区間は表示していません。
                    </span>
                  )}
                </p>
              </div>
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

            {/* マイルストーン到達値（累積） */}
            {milestoneMetrics.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">初速・到達スナップ（累積）</p>
                <div className={`grid gap-2 ${milestoneDefs.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
                  {milestoneDefs.map(ms => (
                    <div
                      key={ms.id}
                      className="rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2.5"
                    >
                      <p className="text-[10px] font-medium text-gray-500 mb-1.5">{ms.label}</p>
                      <div className="space-y-1">
                        {milestoneMetrics.map(m => (
                          <div key={m} className="flex justify-between gap-2 text-xs">
                            <span className="text-gray-500 truncate">{metricLabel(m)}</span>
                            <span className="font-semibold text-gray-800 tabular-nums">
                              {milestoneSummary[ms.id][m]?.toLocaleString() ?? '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {phaseOptions.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setInsightPhase(opt.id)}
                    title={opt.description}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      insightPhase === opt.id
                        ? 'border-purple-500 bg-purple-50 text-purple-800'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 w-fit">
                <button
                  type="button"
                  onClick={() => setInsightValueMode('cumulative')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    insightValueMode === 'cumulative'
                      ? 'bg-white text-purple-800 shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  累積
                </button>
                <button
                  type="button"
                  onClick={() => setInsightValueMode('incremental')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    insightValueMode === 'incremental'
                      ? 'bg-white text-purple-800 shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  増分
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                {insightValueMode === 'cumulative'
                  ? 'Instagram 上の集計値（その時点までの合計）です。'
                  : '前のスナップショットからの差分です。区間の先頭は「区間直前までの累積」との差になります。'}
              </p>
            </div>

            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="elapsed_label"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    labelFormatter={(_, payload) => {
                      const p = payload?.[0]?.payload as { time?: string } | undefined
                      return p?.time ?? ''
                    }}
                  />
                  <Legend />
                  {selectedMetrics.filter(m => metricKeys.includes(m)).map((m, i) => (
                    <Line
                      key={m}
                      type="monotone"
                      dataKey={m}
                      name={
                        insightValueMode === 'incremental'
                          ? `${metricLabel(m)}（増分）`
                          : metricLabel(m)
                      }
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={chartData.length <= 36}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex flex-col items-center justify-center text-gray-400 text-sm text-center px-4">
                {selectedMetrics.length === 0 ? (
                  <>表示する指標を 1 つ以上選んでください。</>
                ) : (
                  <>
                    この表示区間にスナップショットがありません。別の区間に切り替えるか、収集バッチ実行後に再度確認してください。
                  </>
                )}
              </div>
            )}
          </div>

          {/* 類似投稿オーバーレイ + 差分 */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">類似投稿との曲線比較</h3>
              <p className="text-xs text-gray-500 mt-1">
                同一アカウントの直近{isStory ? 'ストーリー' : '投稿（ストーリー除く）'}から最大2件選び、
                <strong>公開からの経過（1h刻み・累積）</strong>で重ねます。差分表はマイルストーン時点の累積比較です。
                {isStory && ' ストーリー同士のみ比較できます。'}
              </p>
            </div>

            {similarPosts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {similarPosts.map(sp => {
                  const on = selectedPeers.includes(sp.id)
                  return (
                    <button
                      key={sp.id}
                      type="button"
                      onClick={() => togglePeer(sp.id)}
                      className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition max-w-[220px] ${
                        on ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {sp.thumbnail_url ? (
                        <img src={sp.thumbnail_url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-gray-100 shrink-0" />
                      )}
                      <span className="text-[10px] text-gray-700 line-clamp-2">
                        {new Date(sp.posted_at).toLocaleDateString('ja-JP')} · {(sp.caption ?? '').slice(0, 40)}
                        {(sp.caption?.length ?? 0) > 40 ? '…' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400">類似候補がありません。</p>
            )}

            {selectedPeers.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500">オーバーレイ指標:</span>
                {overlayMetricChoicesForPost(post).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOverlayMetric(m)}
                    className={`text-xs px-2 py-1 rounded-lg border ${
                      overlayMetric === m ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {metricLabel(m)}
                  </button>
                ))}
              </div>
            )}

            {overlayLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="w-4 h-4 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                比較データを読み込み中…
              </div>
            )}

            {!overlayLoading && overlayData && overlayData.overlayRows.length > 0 && (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={overlayData.overlayRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="elapsed_label" tick={{ fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Legend />
                    {overlayData.posts.map((p, i) => (
                      <Line
                        key={p.id}
                        type="monotone"
                        dataKey={`s_${p.id}`}
                        name={p.label}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>

                {overlayData.diffTables.map(dt => (
                  <div key={dt.peerId} className="rounded-xl border border-gray-100 overflow-hidden">
                    <p className="text-xs font-medium text-gray-600 px-3 py-2 bg-gray-50 border-b border-gray-100">
                      差分ハイライト vs {dt.peerLabel}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="px-3 py-2">マイルストーン</th>
                            <th className="px-3 py-2">指標</th>
                            <th className="px-3 py-2">この投稿</th>
                            <th className="px-3 py-2">比較</th>
                            <th className="px-3 py-2">差%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dt.rows.map((r, idx) => {
                            const strong = r.deltaPct != null && Math.abs(r.deltaPct) >= 15
                            return (
                              <tr
                                key={`${dt.peerId}-${idx}`}
                                className={strong ? 'bg-amber-50/80' : 'hover:bg-gray-50/80'}
                              >
                                <td className="px-3 py-1.5 text-gray-600">{r.milestoneLabel}</td>
                                <td className="px-3 py-1.5">{metricLabel(r.metric)}</td>
                                <td className="px-3 py-1.5 tabular-nums">{r.main?.toLocaleString() ?? '—'}</td>
                                <td className="px-3 py-1.5 tabular-nums">{r.peer?.toLocaleString() ?? '—'}</td>
                                <td className="px-3 py-1.5 tabular-nums">
                                  {r.deltaPct != null ? `${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct.toFixed(0)}%` : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </>
            )}

            {!overlayLoading && selectedPeers.length > 0 && (!overlayData || overlayData.overlayRows.length === 0) && (
              <p className="text-xs text-gray-400">オーバーレイ用のデータがまだ足りません（インサイト収集後に再試行してください）。</p>
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
            <p className="text-[11px] text-gray-400 mb-3">
              実行時は<strong>投稿メタ・マイルストーン累積</strong>をプロンプトに含めます。
              {selectedPeers.length > 0
                ? ` 選択中の類似投稿（${selectedPeers.length}件）とのマイルストーン差分も渡します。`
                : ' 類似投稿を選ぶと比較差分も渡せます。'}
            </p>

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

      <ManualInsightExtraModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        mediaId={id}
        permalink={data?.post?.permalink ?? null}
        onSaved={async () => {
          const refreshed = await fetch(`/api/posts/${id}`)
          const json = await refreshed.json()
          const d = json.data as PostDetailData | null
          if (d && !Array.isArray(d.manual_insight_extra)) d.manual_insight_extra = []
          setData(d)
        }}
      />
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
