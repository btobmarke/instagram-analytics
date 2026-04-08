'use client'

import { useState, use, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import type { IgMedia } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface PostWithInsights extends IgMedia {
  insights: Record<string, number | null>
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

  const { data: serviceData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = serviceData?.data
  const accountId = service?.type_config?.ig_account_ref_id

  const [posts, setPosts] = useState<PostWithInsights[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const limit = 20

  const fetchPosts = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    const params = new URLSearchParams({ account: accountId, limit: String(limit), offset: String(offset) })
    if (filterType) params.set('type', filterType)
    const res = await fetch(`/api/posts?${params}`)
    const json = await res.json()
    setPosts(json.data ?? [])
    setTotal(json.count ?? 0)
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

  return (
    <div className="p-6 max-w-6xl mx-auto pb-24">
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
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-xl">📸</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instagram</h1>
          <p className="text-sm text-gray-400">{service?.service_name}</p>
        </div>
      </div>

      {/* タブナビ */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/analytics`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          ダッシュボード
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/posts`}
          className="px-4 py-2.5 text-sm font-medium text-pink-600 border-b-2 border-pink-600 -mb-px"
        >
          投稿一覧
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          設定
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/summary`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          サマリー
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-gray-500">全{total}件の投稿</p>
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
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer" />
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">投稿</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">種別</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">リーチ</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">いいね</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">保存</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">EG率</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">投稿日</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {posts.map(post => {
                  const reach = post.insights?.reach
                  const likes = post.insights?.likes
                  const saved = post.insights?.saved
                  const totalInteractions = post.insights?.total_interactions
                  const egRate = reach && reach > 0 && totalInteractions != null
                    ? ((totalInteractions / reach) * 100).toFixed(1) : null
                  const isSelected = selectedIds.has(post.id)

                  return (
                    <tr key={post.id} className={`transition ${isSelected ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
                      <td className="w-10 px-4 py-4">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(post.id)}
                          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer" />
                      </td>
                      <td className="px-4 py-4">
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
                          <p className="text-sm text-gray-700 line-clamp-2 max-w-xs">
                            {post.caption ? post.caption.slice(0, 80) + (post.caption.length > 80 ? '…' : '') : '（キャプションなし）'}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${MEDIA_TYPE_COLORS[post.media_product_type ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                          {MEDIA_TYPE_LABELS[post.media_product_type ?? ''] ?? post.media_type}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium">{reach?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium">{likes?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-4 text-right text-sm text-gray-700 font-medium">{saved?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-4 text-right">
                        {egRate ? (
                          <span className={`text-sm font-bold ${parseFloat(egRate) >= 5 ? 'text-green-600' : parseFloat(egRate) >= 2 ? 'text-yellow-600' : 'text-red-500'}`}>
                            {egRate}%
                          </span>
                        ) : <span className="text-gray-400 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500">
                        {new Date(post.posted_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-4">
                        <Link href={`/posts/${post.id}?account=${accountId}&returnTo=/projects/${projectId}/services/${serviceId}/instagram/posts`}
                          className="text-gray-300 hover:text-purple-400 transition">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
