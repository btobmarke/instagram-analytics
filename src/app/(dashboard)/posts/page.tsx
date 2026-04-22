'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import type { IgMedia } from '@/types'
import { ManualInsightExtraModal } from '@/components/posts/ManualInsightExtraModal'
import {
  DASHBOARD_POST_LIST_COLUMNS,
  PostListColumnToggles,
  postListFancyCheckboxClass,
  usePostListColumnVisibility,
} from '@/components/posts/post-list-column-visibility'
import {
  apiTypeParamForListMode,
  postListModeFromQueryParam,
  type PostListMode,
} from '@/lib/instagram/post-display-mode'

const POST_LIST_COL_STORAGE_KEY = 'ig_dashboard_posts_list_columns_v2'
const POST_LIST_COL_STORAGE_KEY_STORY = 'ig_dashboard_posts_list_columns_story_v1'

const STORY_LIST_COLUMN_IDS = new Set([
  'type',
  'views',
  'reach',
  'replies',
  'exits',
  'taps_forward',
  'taps_back',
  'postedAt',
  'detail',
])

interface PostWithInsights extends IgMedia {
  insights: Record<string, number | null>
  /** 手入力インサイトの「ホーム」件数（最新）。ホーム率の分子に使用 */
  manual_views_from_home?: number | null
}

const MEDIA_TYPE_LABELS: Record<string, string> = {
  FEED: 'フィード',
  REELS: 'リール',
  STORY: 'ストーリー',
  AD: '広告',
}

const MEDIA_TYPE_COLORS: Record<string, string> = {
  FEED: 'bg-blue-100 text-blue-700',
  REELS: 'bg-purple-100 text-purple-700',
  STORY: 'bg-pink-100 text-pink-700',
  AD: 'bg-gray-100 text-gray-700',
}

function PostsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const accountId = searchParams.get('account')
  const listMode: PostListMode = postListModeFromQueryParam(
    searchParams.get('type'),
    searchParams.get('mode')
  )
  const listColumns =
    listMode === 'story'
      ? DASHBOARD_POST_LIST_COLUMNS.filter(c => STORY_LIST_COLUMN_IDS.has(c.id))
      : DASHBOARD_POST_LIST_COLUMNS
  const columnStorageKey =
    listMode === 'story' ? POST_LIST_COL_STORAGE_KEY_STORY : POST_LIST_COL_STORAGE_KEY

  const [posts, setPosts] = useState<PostWithInsights[]>([])
  const [followersCount, setFollowersCount] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [manualModal, setManualModal] = useState<{ id: string; permalink: string | null } | null>(null)
  const limit = 20
  const { visible, isOn, toggle } = usePostListColumnVisibility(columnStorageKey, listColumns)

  const fetchPosts = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    const params = new URLSearchParams({
      account: accountId,
      limit: String(limit),
      offset: String(offset),
    })
    const apiType = apiTypeParamForListMode(listMode)
    if (apiType) params.set('type', apiType)
    if (listMode === 'feed') {
      params.set('types', 'FEED,REELS,VIDEO')
    }
    const res = await fetch(`/api/posts?${params}`)
    const json = await res.json()
    setPosts(json.data ?? [])
    setTotal(json.count ?? 0)
    setFollowersCount(typeof json.followers_count === 'number' ? json.followers_count : null)
    setLoading(false)
  }, [accountId, offset, listMode])

  useEffect(() => { fetchPosts() }, [fetchPosts])
  useEffect(() => { setSelectedIds(new Set()) }, [offset, listMode])

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds(selectedIds.size === posts.length ? new Set() : new Set(posts.map(p => p.id)))
  }

  const goToAnalysis = () => {
    if (selectedIds.size === 0 || !accountId) return
    const ids = Array.from(selectedIds).join(',')
    router.push(`/posts/analysis?account=${accountId}&ids=${ids}`)
  }

  if (!accountId) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        サイドバーからアカウントを選択してください
      </div>
    )
  }

  const totalPages = Math.ceil(total / limit)
  const currentPage = Math.floor(offset / limit) + 1
  const allSelected = posts.length > 0 && selectedIds.size === posts.length

  /** 縦スクロールで追従するヘッダー共通 */
  const thTop =
    'sticky top-0 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 tracking-wide shadow-[0_1px_0_rgba(0,0,0,0.06)] whitespace-nowrap border-b border-gray-100'
  /** 左固定（チェック列）— 横スクロール時も常に表示 */
  const thStickyCheck = `${thTop} left-0 z-50 w-14 min-w-[3.5rem] box-border border-r border-gray-200 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)] text-left`
  /** 左固定（投稿列）— left はチェック列幅に合わせる（Tailwind left-14 = 3.5rem = w-14） */
  const thStickyPost = `${thTop} left-14 z-50 min-w-[100px] max-w-[min(190px,22vw)] box-border border-r border-gray-200 shadow-[4px_0_14px_-4px_rgba(0,0,0,0.1)] text-left`
  /** 指標ヘッダー（横スクロールで移動） */
  const thMetrics = `${thTop} z-10`

  return (
    <div className="w-full max-w-none mx-auto min-w-0 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">投稿一覧</h1>
          <p className="text-sm text-gray-500 mt-1">
            全{total}件の投稿
            {' · '}
            <Link href={`/like-users?account=${accountId}`} className="text-purple-600 hover:text-purple-700 font-medium">
              いいねユーザー分析
            </Link>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {(
            [
              { mode: 'feed' as const, label: 'フィード・リール' },
              { mode: 'story' as const, label: 'ストーリー' },
            ] as const
          ).map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                const p = new URLSearchParams(searchParams.toString())
                p.delete('type')
                p.set('mode', mode)
                router.push(`/posts?${p}`)
                setOffset(0)
              }}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${
                listMode === mode ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
          <p className="text-gray-500">投稿が見つかりません</p>
          <p className="text-sm text-gray-400 mt-2">バッチを実行してデータを収集してください</p>
        </div>
      ) : (
        <>
          <div className="min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="p-4 pb-0">
              <PostListColumnToggles columns={listColumns} visible={visible} onToggle={toggle} />
            </div>
            <div className="min-w-0 overflow-x-auto px-2 pb-2">
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr>
                  <th className={thStickyCheck} scope="col">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className={postListFancyCheckboxClass} />
                  </th>
                  <th className={thStickyPost} scope="col">投稿</th>
                  {isOn('type') && (
                    <th className={`${thMetrics} text-left min-w-[5.5rem] whitespace-nowrap`}>種別</th>
                  )}
                  {isOn('views') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>表示</th>}
                  {isOn('homeRate') && (
                    <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`} title="手入力のホーム件数 ÷ アカウントのフォロワー数">
                      ホーム率
                    </th>
                  )}
                  {isOn('reach') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>リーチ</th>}
                  {isOn('likes') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>いいね</th>}
                  {isOn('saved') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>保存</th>}
                  {isOn('shares') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>シェア</th>}
                  {isOn('shareRate') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>シェア率</th>}
                  {isOn('egRate') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>EG率</th>}
                  {isOn('replies') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>返信</th>}
                  {isOn('exits') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>離脱</th>}
                  {isOn('taps_forward') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>次へ</th>}
                  {isOn('taps_back') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>戻る</th>}
                  {isOn('postedAt') && <th className={`${thMetrics} text-left min-w-[5rem]`}>投稿日</th>}
                  {isOn('manual') && <th className={`${thMetrics} text-center px-2 min-w-[4.5rem]`}>手入力</th>}
                  {isOn('detail') && (
                    <th className={`${thMetrics} w-14 min-w-[3.5rem]`} scope="col">
                      <span className="sr-only">詳細</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {posts.map((post) => {
                  const reach = post.insights?.reach
                  const views = post.insights?.views
                  const likes = post.insights?.likes
                  const saved = post.insights?.saved
                  const shares = post.insights?.shares
                  const replies = post.insights?.replies
                  const exits = post.insights?.exits
                  const tapsForward = post.insights?.taps_forward
                  const tapsBack = post.insights?.taps_back
                  const totalInteractions = post.insights?.total_interactions
                  const egRate = reach && reach > 0 && totalInteractions != null
                    ? ((totalInteractions / reach) * 100).toFixed(1) : null
                  const shareRate =
                    reach != null && reach > 0 && shares != null
                      ? ((shares / reach) * 100).toFixed(2)
                      : null
                  const manualHome = post.manual_views_from_home
                  const homeRatePct =
                    manualHome != null && followersCount != null && followersCount > 0
                      ? (manualHome / followersCount) * 100
                      : null
                  const isSelected = selectedIds.has(post.id)

                  const rowBg = isSelected ? 'bg-purple-50 hover:bg-purple-50' : 'bg-white hover:bg-gray-50'

                  return (
                    <tr key={post.id} className={`transition ${rowBg}`}>
                      <td className={`sticky left-0 z-30 w-14 min-w-[3.5rem] box-border border-r border-gray-200 px-4 py-4 align-top bg-inherit`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(post.id)}
                          className={postListFancyCheckboxClass}
                        />
                      </td>
                      <td className={`sticky left-14 z-30 min-w-[100px] max-w-[min(190px,22vw)] box-border border-r border-gray-200 px-4 py-4 align-top bg-inherit shadow-[4px_0_14px_-6px_rgba(0,0,0,0.08)]`}>
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                            {(post.thumbnail_url || post.media_url) ? (
                              <img src={post.thumbnail_url ?? post.media_url ?? ''} alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 line-clamp-2 max-w-md">
                            {post.caption ? post.caption.slice(0, 80) + (post.caption.length > 80 ? '…' : '') : '（キャプションなし）'}
                          </p>
                        </div>
                      </td>
                      {isOn('type') && (
                        <td className="px-4 py-4 align-top whitespace-nowrap">
                          <span
                            className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${MEDIA_TYPE_COLORS[post.media_product_type ?? ''] ?? 'bg-gray-100 text-gray-600'}`}
                          >
                            {MEDIA_TYPE_LABELS[post.media_product_type ?? ''] ?? post.media_type}
                          </span>
                        </td>
                      )}
                      {isOn('views') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">{views?.toLocaleString() ?? '—'}</td>
                      )}
                      {isOn('homeRate') && (
                        <td className="px-4 py-4 text-right align-top">
                          {homeRatePct != null ? (
                            <span
                              className={`text-sm font-bold tabular-nums ${
                                homeRatePct < 50
                                  ? 'text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-md'
                                  : 'text-gray-800'
                              }`}
                            >
                              {homeRatePct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-gray-400 text-sm">—</span>
                          )}
                        </td>
                      )}
                      {isOn('reach') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">{reach?.toLocaleString() ?? '—'}</td>
                      )}
                      {isOn('likes') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">{likes?.toLocaleString() ?? '—'}</td>
                      )}
                      {isOn('saved') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">{saved?.toLocaleString() ?? '—'}</td>
                      )}
                      {isOn('shares') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">{shares?.toLocaleString() ?? '—'}</td>
                      )}
                      {isOn('shareRate') && (
                        <td className="px-4 py-4 text-right align-top">
                          {shareRate != null ? (
                            <span
                              className={`text-sm font-bold tabular-nums ${
                                parseFloat(shareRate) >= 1
                                  ? 'text-green-600'
                                  : parseFloat(shareRate) >= 0.3
                                    ? 'text-yellow-600'
                                    : 'text-gray-600'
                              }`}
                            >
                              {shareRate}%
                            </span>
                          ) : (
                            <span className="text-gray-400 text-sm">—</span>
                          )}
                        </td>
                      )}
                      {isOn('egRate') && (
                        <td className="px-4 py-4 text-right align-top">
                          {egRate ? (
                            <span className={`text-sm font-bold ${parseFloat(egRate) >= 5 ? 'text-green-600' : parseFloat(egRate) >= 2 ? 'text-yellow-600' : 'text-red-500'}`}>
                              {egRate}%
                            </span>
                          ) : <span className="text-gray-400 text-sm">—</span>}
                        </td>
                      )}
                      {isOn('replies') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">
                          {replies?.toLocaleString() ?? '—'}
                        </td>
                      )}
                      {isOn('exits') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">
                          {exits?.toLocaleString() ?? '—'}
                        </td>
                      )}
                      {isOn('taps_forward') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">
                          {tapsForward?.toLocaleString() ?? '—'}
                        </td>
                      )}
                      {isOn('taps_back') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">
                          {tapsBack?.toLocaleString() ?? '—'}
                        </td>
                      )}
                      {isOn('postedAt') && (
                        <td className="px-4 py-4 text-sm text-gray-500 whitespace-nowrap align-top">
                          {new Date(post.posted_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                        </td>
                      )}
                      {isOn('manual') && (
                        <td className="px-2 py-4 text-center align-top">
                          <button
                            type="button"
                            onClick={() => setManualModal({ id: post.id, permalink: post.permalink ?? null })}
                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 transition whitespace-nowrap"
                          >
                            登録
                          </button>
                        </td>
                      )}
                      {isOn('detail') && (
                        <td className="px-4 py-4 align-top">
                          <Link
                            href={`/posts/${post.id}?account=${accountId}&returnTo=${encodeURIComponent(
                              `/posts?account=${accountId}&mode=${listMode}`
                            )}`}
                            className="text-sm font-medium text-purple-600 hover:text-purple-700 whitespace-nowrap"
                          >
                            詳細 →
                          </Link>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">{offset + 1}〜{Math.min(offset + limit, total)}件 / 全{total}件</p>
              <div className="flex gap-2">
                <button disabled={currentPage === 1} onClick={() => setOffset(Math.max(0, offset - limit))}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition">前へ</button>
                <button disabled={currentPage === totalPages} onClick={() => setOffset(offset + limit)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition">次へ</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* フローティング比較バー */}
      <ManualInsightExtraModal
        open={manualModal != null}
        mediaId={manualModal?.id ?? ''}
        permalink={manualModal?.permalink ?? null}
        onClose={() => setManualModal(null)}
      />

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-gray-900 text-white px-6 py-3.5 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
          <span className="text-sm font-medium">
            <span className="text-purple-400 font-bold">{selectedIds.size}件</span> 選択中
          </span>
          <div className="w-px h-5 bg-gray-700" />
          <button onClick={() => setSelectedIds(new Set())}
            className="text-sm text-gray-400 hover:text-white transition">選択解除</button>
          <button onClick={goToAnalysis}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            投稿比較分析
          </button>
        </div>
      )}
    </div>
  )
}

export default function PostsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>}>
      <PostsContent />
    </Suspense>
  )
}
