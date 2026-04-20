'use client'

import { useState, use, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import type { IgMedia } from '@/types'
import {
  PostListColumnToggles,
  SERVICE_POST_LIST_COLUMNS,
  postListFancyCheckboxClass,
  usePostListColumnVisibility,
} from '@/components/posts/post-list-column-visibility'
import { InstagramServiceSubnav } from '@/components/instagram/InstagramServiceSubnav'
import { InstagramFollowerImportButtonModal } from '@/components/instagram/InstagramFollowerImportButtonModal'

const SERVICE_POST_LIST_COL_STORAGE_KEY = 'ig_service_posts_list_columns_v3'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface PostWithInsights extends IgMedia {
  insights: Record<string, number | null>
  manual_views_from_home?: number | null
  manual_views_follower_pct?: number | null
  manual_views_non_follower_pct?: number | null
  views_follower_count?: number | null
  views_non_follower_count?: number | null
}

const MEDIA_TYPE_LABELS: Record<string, string> = {
  FEED: 'フィード', REELS: 'リール', STORY: 'ストーリー', AD: '広告',
}
const MEDIA_TYPE_COLORS: Record<string, string> = {
  FEED: 'bg-blue-100 text-blue-700',
  REELS: 'bg-purple-100 text-purple-700',
  STORY: 'bg-pink-100 text-pink-700',
  AD: 'bg-gray-100 text-gray-700',
}

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
  type_config: { ig_account_ref_id?: string } | null
}

export default function ServicePostsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const router = useRouter()

  const { data: serviceData, mutate: mutateService } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = serviceData?.data
  const accountId = service?.type_config?.ig_account_ref_id

  const [posts, setPosts] = useState<PostWithInsights[]>([])
  const [followersCount, setFollowersCount] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const limit = 20
  const { visible, isOn, toggle } = usePostListColumnVisibility(SERVICE_POST_LIST_COL_STORAGE_KEY, SERVICE_POST_LIST_COLUMNS)

  const fetchPosts = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    const params = new URLSearchParams({ account: accountId, limit: String(limit), offset: String(offset) })
    if (filterType) params.set('type', filterType)
    const res = await fetch(`/api/posts?${params}`)
    const json = await res.json()
    setPosts(json.data ?? [])
    setTotal(json.count ?? 0)
    setFollowersCount(typeof json.followers_count === 'number' ? json.followers_count : null)
    setLoading(false)
  }, [accountId, offset, filterType])

  useEffect(() => { fetchPosts() }, [fetchPosts])
  useEffect(() => { setSelectedIds(new Set()) }, [offset, filterType])

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setSelectedIds(selectedIds.size === posts.length ? new Set() : new Set(posts.map(p => p.id)))
  }

  const goToAnalysis = () => {
    if (selectedIds.size === 0 || !accountId) return
    const ids = Array.from(selectedIds).join(',')
    router.push(`/posts/analysis?account=${accountId}&ids=${ids}&returnTo=/projects/${projectId}/services/${serviceId}/instagram/posts`)
  }

  const totalPages = Math.ceil(total / limit)
  const currentPage = Math.floor(offset / limit) + 1
  const allSelected = posts.length > 0 && selectedIds.size === posts.length

  const thTop =
    'sticky top-0 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 tracking-wide shadow-[0_1px_0_rgba(0,0,0,0.06)] whitespace-nowrap border-b border-gray-100'
  const thStickyCheck = `${thTop} left-0 z-50 w-14 min-w-[3.5rem] box-border border-r border-gray-200 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)] text-left`
  const thStickyPost = `${thTop} left-14 z-50 min-w-[100px] max-w-[min(190px,22vw)] box-border border-r border-gray-200 shadow-[4px_0_14px_-4px_rgba(0,0,0,0.1)] text-left`
  const thMetrics = `${thTop} z-10`

  return (
    <div className="p-6 w-full max-w-none mx-auto min-w-0 pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/clients" className="hover:text-purple-600">クライアント一覧</Link>
        <span>›</span>
        <Link href={`/clients/${service?.client.id}`} className="hover:text-purple-600">{service?.client.client_name}</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">{service?.project.project_name}</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/instagram`} className="hover:text-pink-600">
          {service?.service_name ?? 'Instagram'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">投稿一覧</span>
      </nav>

      {/* サービスヘッダー */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-xl flex-shrink-0">
            📸
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Instagram</h1>
            <p className="text-sm text-gray-400">{service?.service_name}</p>
          </div>
        </div>
        <InstagramFollowerImportButtonModal accountId={accountId} onImported={() => mutateService()} />
      </div>

      <InstagramServiceSubnav projectId={projectId} serviceId={serviceId} active="posts" />

      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-gray-500">
            全{total}件の投稿
            {accountId && (
              <>
                {' · '}
                <Link
                  href={`/projects/${projectId}/services/${serviceId}/instagram/like-users`}
                  className="text-purple-600 hover:text-purple-700 font-medium"
                >
                  いいねユーザー分析
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {['', 'FEED', 'REELS', 'STORY'].map(t => (
            <button key={t}
              onClick={() => { setFilterType(t); setOffset(0) }}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${filterType === t ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {t === '' ? 'すべて' : MEDIA_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* 選択時のアクションバー */}
      {selectedIds.size > 0 && (
        <div className="sticky top-4 z-10 mb-4 bg-purple-600 text-white rounded-xl px-5 py-3 flex items-center justify-between shadow-lg">
          <span className="text-sm font-medium">{selectedIds.size}件を選択中</span>
          <div className="flex gap-3">
            <button onClick={() => setSelectedIds(new Set())}
              className="text-sm text-purple-200 hover:text-white transition">選択解除</button>
            <button onClick={goToAnalysis}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-white text-purple-700 text-sm font-semibold rounded-lg hover:bg-purple-50 transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              AI 比較分析
            </button>
          </div>
        </div>
      )}

      {!accountId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center text-amber-800">
          <p className="font-semibold mb-1">Instagram アカウントが未連携です</p>
          <Link href={`/projects/${projectId}/services/${serviceId}/instagram`}
            className="text-sm text-amber-700 font-medium hover:underline">
            ← サービスページでアカウントを連携する
          </Link>
        </div>
      ) : loading ? (
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
              <PostListColumnToggles columns={SERVICE_POST_LIST_COLUMNS} visible={visible} onToggle={toggle} />
            </div>
            <div className="min-w-0 overflow-x-auto px-2 pb-2">
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr>
                  <th className={thStickyCheck} scope="col">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className={postListFancyCheckboxClass} />
                  </th>
                  <th className={thStickyPost} scope="col">投稿</th>
                  {isOn('type') && <th className={`${thMetrics} text-left min-w-[5.5rem]`}>種別</th>}
                  {isOn('views') && <th className={`${thMetrics} text-right tabular-nums min-w-[4.5rem]`}>表示</th>}
                  {isOn('viewsFollowerPct') && (
                    <th
                      className={`${thMetrics} text-right tabular-nums min-w-[5.5rem]`}
                      title="手入力インサイトの「ビュー · フォロワー %」（投稿詳細で登録）"
                    >
                      ビュー·フォロワー率
                    </th>
                  )}
                  {isOn('viewsNonFollowerPct') && (
                    <th
                      className={`${thMetrics} text-right tabular-nums min-w-[5.5rem]`}
                      title="手入力インサイトの「ビュー · フォロワー以外 %」"
                    >
                      ビュー·フォロワー外率
                    </th>
                  )}
                  {isOn('viewsFollowerCount') && (
                    <th
                      className={`${thMetrics} text-right tabular-nums min-w-[5.5rem]`}
                      title="表示回数 × フォロワー率（手入力%がある場合）"
                    >
                      フォロワービュー
                    </th>
                  )}
                  {isOn('viewsNonFollowerCount') && (
                    <th
                      className={`${thMetrics} text-right tabular-nums min-w-[5.5rem]`}
                      title="表示回数 × フォロワー外率、または表示 − フォロワービュー"
                    >
                      フォロワー外ビュー
                    </th>
                  )}
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
                  {isOn('postedAt') && <th className={`${thMetrics} text-left min-w-[5rem]`}>投稿日</th>}
                  {isOn('detail') && (
                    <th className={`${thMetrics} w-12 min-w-[3rem]`} scope="col">
                      <span className="sr-only">詳細</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {posts.map(post => {
                  const reach = post.insights?.reach
                  const views = post.insights?.views
                  const vfPct = post.manual_views_follower_pct
                  const vnfPct = post.manual_views_non_follower_pct
                  const vfCount = post.views_follower_count
                  const vnfCount = post.views_non_follower_count
                  const likes = post.insights?.likes
                  const saved = post.insights?.saved
                  const shares = post.insights?.shares
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
                      <td className="sticky left-0 z-30 w-14 min-w-[3.5rem] box-border border-r border-gray-200 px-4 py-4 align-top bg-inherit">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(post.id)}
                          className={postListFancyCheckboxClass}
                        />
                      </td>
                      <td className="sticky left-14 z-30 min-w-[100px] max-w-[min(190px,22vw)] box-border border-r border-gray-200 px-4 py-4 align-top bg-inherit shadow-[4px_0_14px_-6px_rgba(0,0,0,0.08)]">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                            {(post.thumbnail_url || post.media_url) ? (
                              <img src={post.thumbnail_url ?? post.media_url ?? ''} alt=""
                                className="w-full h-full object-cover"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
                        <td className="px-4 py-4 align-top">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${MEDIA_TYPE_COLORS[post.media_product_type ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                            {MEDIA_TYPE_LABELS[post.media_product_type ?? ''] ?? post.media_type}
                          </span>
                        </td>
                      )}
                      {isOn('views') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">{views?.toLocaleString() ?? '—'}</td>
                      )}
                      {isOn('viewsFollowerPct') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">
                          {vfPct != null && Number.isFinite(Number(vfPct)) ? `${Number(vfPct).toFixed(1)}%` : '—'}
                        </td>
                      )}
                      {isOn('viewsNonFollowerPct') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">
                          {vnfPct != null && Number.isFinite(Number(vnfPct)) ? `${Number(vnfPct).toFixed(1)}%` : '—'}
                        </td>
                      )}
                      {isOn('viewsFollowerCount') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">
                          {vfCount != null ? vfCount.toLocaleString() : '—'}
                        </td>
                      )}
                      {isOn('viewsNonFollowerCount') && (
                        <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium tabular-nums align-top">
                          {vnfCount != null ? vnfCount.toLocaleString() : '—'}
                        </td>
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
                      {isOn('postedAt') && (
                        <td className="px-4 py-4 text-sm text-gray-500 whitespace-nowrap align-top">
                          {new Date(post.posted_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                        </td>
                      )}
                      {isOn('detail') && (
                        <td className="px-4 py-4 align-top">
                          <Link href={`/posts/${post.id}?account=${accountId}&returnTo=/projects/${projectId}/services/${serviceId}/instagram/posts`}
                            className="text-gray-300 hover:text-purple-400 transition inline-flex" title="詳細">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
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

          {/* ページネーション */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button onClick={() => setOffset(o => Math.max(0, o - limit))} disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
                前へ
              </button>
              <span className="text-sm text-gray-500">{currentPage} / {totalPages}</span>
              <button onClick={() => setOffset(o => o + limit)} disabled={currentPage >= totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
                次へ
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
