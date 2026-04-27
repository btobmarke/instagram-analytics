'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import type { IgMedia } from '@/types'
import { MarkdownRenderer, BlinkingCursor } from '@/components/ai/MarkdownRenderer'
import { PostMediaSlider } from '@/components/posts/PostMediaSlider'

// ===== 型定義 =====
interface PostAnalysisResult {
  post: IgMedia
  chartData: Array<Record<string, string | number | null>>
  latestInsights: Record<string, number | null>
  availableMetrics: string[]
}

type Grain = 'hourly' | '12h' | 'daily'

// ===== 定数 =====
const METRIC_LABELS: Record<string, string> = {
  reach: 'リーチ',
  impressions: 'インプレッション',
  likes: 'いいね',
  comments: 'コメント',
  saved: '保存',
  shares: 'シェア',
  video_views: '動画再生',
  total_interactions: 'インタラクション',
  profile_visits: 'プロフィール訪問',
  ig_reels_aggregated_all_plays_count: 'リール再生',
}

const METRIC_COLORS: Record<string, string> = {
  reach: '#3B82F6',
  impressions: '#8B5CF6',
  likes: '#EF4444',
  comments: '#F59E0B',
  saved: '#10B981',
  shares: '#06B6D4',
  video_views: '#F97316',
  total_interactions: '#EC4899',
  profile_visits: '#84CC16',
  ig_reels_aggregated_all_plays_count: '#6366F1',
}

const DEFAULT_METRICS = ['reach', 'likes', 'saved']

const GRAIN_OPTIONS: { value: Grain; label: string }[] = [
  { value: 'hourly', label: '1時間' },
  { value: '12h', label: '12時間' },
  { value: 'daily', label: '1日' },
]

const MEDIA_TYPE_LABELS: Record<string, string> = {
  FEED: 'フィード', REELS: 'リール', STORY: 'ストーリー', AD: '広告',
}

// ===== フォーマット関数 =====
function formatTime(isoString: string, grain: Grain) {
  const d = new Date(isoString)
  if (grain === 'daily') return `${d.getMonth() + 1}/${d.getDate()}`
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`
}

function formatNumber(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`
  return v.toLocaleString()
}

// ===== 本体 =====
function AnalysisContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const accountId = searchParams.get('account') ?? ''
  const idsParam = searchParams.get('ids') ?? ''

  const [results, setResults] = useState<PostAnalysisResult[]>([])
  const [loading, setLoading] = useState(true)
  const [grain, setGrain] = useState<Grain>('hourly')
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set(DEFAULT_METRICS))
  const [activeTab, setActiveTab] = useState<'content' | 'metrics'>('content')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiText, setAiText] = useState('')

  // 全投稿のavailableMetricsを合算
  const allAvailableMetrics = Array.from(
    new Set(results.flatMap(r => r.availableMetrics))
  ).filter(m => m in METRIC_LABELS)

  const fetchData = useCallback(async () => {
    if (!idsParam) return
    setLoading(true)
    const params = new URLSearchParams({ ids: idsParam, grain, account: accountId })
    const res = await fetch(`/api/posts/analysis?${params}`)
    const json = await res.json()
    setResults(json.posts ?? [])
    setLoading(false)
  }, [idsParam, grain, accountId])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    setAiText('')
    setAiError(null)
    setAiLoading(false)
  }, [idsParam])

  const canRunAiComparison = results.length >= 2

  const runAiComparison = useCallback(async () => {
    if (!canRunAiComparison) return
    setAiError(null)
    setAiLoading(true)
    setAiText('')
    try {
      const res = await fetch('/api/posts/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: results.map((r) => r.post.id) }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setAiError(j.error ?? 'エラーが発生しました')
        setAiLoading(false)
        return
      }
      if (!res.body) {
        setAiLoading(false)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setAiText(text)
      }
    } catch {
      setAiError('通信エラーが発生しました')
    } finally {
      setAiLoading(false)
    }
  }, [results, canRunAiComparison])

  const toggleMetric = (metric: string) => {
    setSelectedMetrics(prev => {
      const next = new Set(prev)
      if (next.has(metric)) {
        if (next.size > 1) next.delete(metric) // 最低1つ
      } else {
        next.add(metric)
      }
      return next
    })
  }

  const postCount = results.length
  // グリッドカラム数（最大3列、モバイルは常に1列）
  const colClass =
    postCount === 1 ? 'grid-cols-1' :
    postCount === 2 ? 'grid-cols-1 sm:grid-cols-2' :
    'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => router.push(`/posts?account=${accountId}`)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            投稿一覧
          </button>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-bold text-gray-900">投稿比較分析</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
            {postCount}件比較中
          </span>
        </div>
        {!loading && results.length > 0 && (
          <button
            type="button"
            onClick={() => void runAiComparison()}
            disabled={!canRunAiComparison || aiLoading}
            title={
              !canRunAiComparison
                ? 'AI比較解説は投稿を2件以上選んだときに利用できます'
                : undefined
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm hover:from-purple-700 hover:to-pink-700 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-400"
          >
            {aiLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                AI分析中…
              </>
            ) : (
              <>
                <span aria-hidden>✨</span>
                AIで比較解説
              </>
            )}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">データを読み込んでいます...</p>
        </div>
      ) : results.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
          <p className="text-gray-500">投稿データが見つかりません</p>
        </div>
      ) : (
        <>
          {/* コントロール */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5 shadow-sm">
            <div className="flex flex-wrap items-start gap-6">
              {/* 時間軸 */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">時間軸</p>
                <div className="flex gap-1.5">
                  {GRAIN_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => setGrain(opt.value)}
                      className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition ${grain === opt.value ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 指標選択 */}
              <div className="flex-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">表示指標</p>
                <div className="flex flex-wrap gap-2">
                  {(allAvailableMetrics.length > 0 ? allAvailableMetrics : Object.keys(METRIC_LABELS)).map(metric => {
                    const isSelected = selectedMetrics.has(metric)
                    const color = METRIC_COLORS[metric] ?? '#6B7280'
                    return (
                      <button key={metric} onClick={() => toggleMetric(metric)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition ${isSelected ? 'border-transparent text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        style={isSelected ? { backgroundColor: color } : {}}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isSelected ? 'white' : color }} />
                        {METRIC_LABELS[metric] ?? metric}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {(aiError || aiText || aiLoading) && (
            <div className="bg-white rounded-2xl border border-purple-100 p-5 mb-5 shadow-sm">
              <h2 className="text-sm font-semibold text-purple-900 mb-3">AI 比較解説</h2>
              {aiError && <p className="text-sm text-red-600">{aiError}</p>}
              {aiText ? (
                <div className="relative">
                  <MarkdownRenderer content={aiText} />
                  {aiLoading && <BlinkingCursor />}
                </div>
              ) : aiLoading ? (
                <p className="text-sm text-gray-500">回答を生成しています…</p>
              ) : null}
            </div>
          )}

          {/* グラフエリア */}
          <div className={`grid ${colClass} gap-4 mb-5`}>
            {results.map((result, idx) => {
              const post = result.post
              const postedDate = new Date(post.posted_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
              const chartMetrics = Array.from(selectedMetrics).filter(m => result.availableMetrics.includes(m))
              const hasData = result.chartData.length > 0

              return (
                <div key={post.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                  {/* カードヘッダー */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500">{postedDate}</span>
                        {post.media_product_type && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                            {MEDIA_TYPE_LABELS[post.media_product_type] ?? post.media_product_type}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 line-clamp-1 mt-0.5">
                        {post.caption?.slice(0, 50) ?? '（キャプションなし）'}
                      </p>
                    </div>
                  </div>

                  {/* グラフ */}
                  <div className="p-4">
                    {!hasData ? (
                      <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                        スナップショットデータがありません
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={result.chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis
                            dataKey="time"
                            tick={{ fontSize: 10, fill: '#9CA3AF' }}
                            tickFormatter={v => formatTime(String(v), grain)}
                            interval="preserveStartEnd"
                          />
                          <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} width={45}
                            tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(v)} />
                          <Tooltip
                            formatter={(value, name: string) => [
                              typeof value === 'number' ? value.toLocaleString() : '—',
                              METRIC_LABELS[name] ?? name,
                            ]}
                            labelFormatter={label => formatTime(String(label), grain)}
                            contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #E5E7EB' }}
                          />
                          <Legend formatter={name => METRIC_LABELS[name] ?? name}
                            wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                          {chartMetrics.map(metric => (
                            <Line key={metric} type="monotone" dataKey={metric}
                              stroke={METRIC_COLORS[metric] ?? '#6B7280'}
                              strokeWidth={2} dot={false} connectNulls />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* 最新指標サマリー */}
                  <div className="grid grid-cols-3 gap-px bg-gray-100 border-t border-gray-100">
                    {['reach', 'likes', 'saved'].map(metric => (
                      <div key={metric} className="bg-white px-3 py-2.5 text-center">
                        <p className="text-xs text-gray-400">{METRIC_LABELS[metric]}</p>
                        <p className="text-sm font-bold text-gray-800 mt-0.5">
                          {formatNumber(result.latestInsights[metric])}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 投稿内容・指標値タブ */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* タブ */}
            <div className="flex border-b border-gray-100">
              {([['content', '投稿内容'], ['metrics', '指標値']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`px-6 py-3.5 text-sm font-semibold transition border-b-2 ${activeTab === key ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* 投稿内容タブ */}
            {activeTab === 'content' && (
              <div className={`grid ${colClass} divide-x divide-gray-100`}>
                {results.map((result, idx) => {
                  const post = result.post
                  const children =
                    (post.children_json as Array<{ media_url?: string; thumbnail_url?: string }> | null)?.map((c) => ({
                      mediaUrl: c.media_url,
                      thumbnailUrl: c.thumbnail_url,
                    })) ?? null

                  return (
                    <div key={post.id} className="p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                        <span className="text-sm font-medium text-gray-700">
                          {new Date(post.posted_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {/* カルーセル対応スライダー */}
                      <div className="mb-3">
                        <PostMediaSlider
                          mediaUrl={post.media_url}
                          thumbnailUrl={post.thumbnail_url}
                          children={children}
                        />
                      </div>

                      {/* キャプション */}
                      <p className="text-sm text-gray-700 whitespace-pre-line line-clamp-6">
                        {post.caption ?? '（キャプションなし）'}
                      </p>

                      {/* Instagramリンク */}
                      {post.permalink && (
                        <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700">
                          Instagramで見る
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 指標値タブ */}
            {activeTab === 'metrics' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 w-24">指標</th>
                      {results.map((result, idx) => (
                        <th key={result.post.id} className="text-right text-xs font-semibold text-gray-500 px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                            {new Date(result.post.posted_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {Object.keys(METRIC_LABELS).map(metric => {
                      const hasAnyData = results.some(r => r.latestInsights[metric] != null)
                      if (!hasAnyData) return null
                      const values = results.map(r => r.latestInsights[metric] ?? null)
                      const maxVal = Math.max(...values.filter((v): v is number => v !== null))

                      return (
                        <tr key={metric} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-xs font-medium text-gray-600">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: METRIC_COLORS[metric] ?? '#6B7280' }} />
                              {METRIC_LABELS[metric]}
                            </div>
                          </td>
                          {values.map((val, i) => (
                            <td key={i} className="px-4 py-3 text-right">
                              <span className={`font-semibold ${val === maxVal && val !== null ? 'text-purple-600' : 'text-gray-700'}`}>
                                {formatNumber(val)}
                              </span>
                              {val === maxVal && val !== null && results.length > 1 && (
                                <span className="ml-1 text-xs text-purple-400">↑</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function PostsAnalysisPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    }>
      <AnalysisContent />
    </Suspense>
  )
}
