'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import type { IgMedia } from '@/types'

interface PostWithInsights extends IgMedia {
  insights: Record<string, number | null>
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
  const filterType = searchParams.get('type') ?? ''

  const [posts, setPosts] = useState<PostWithInsights[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const limit = 20

  const fetchPosts = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    const params = new URLSearchParams({
      account: accountId,
      limit: String(limit),
      offset: String(offset),
    })
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

  return (
    <div className="max-w-6xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">投稿一覧</h1>
          <p className="text-sm text-gray-500 mt-1">全{total}件の投稿</p>
        </div>
        <div className="flex gap-2">
          {['', 'FEED', 'REELS', 'STORY'].map((t) => (
            <button key={t}
              onClick={() => {
                const p = new URLSearchParams(searchParams.toString())
                if (t) p.set('type', t); else p.delete('type')
                router.push(`/posts?${p}`)
                setOffset(0)
              }}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${filterType === t ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {t === '' ? 'すべて' : MEDIA_TYPE_LABELS[t]}
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
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
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
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {posts.map((post) => {
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
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
                        <Link href={`/posts/${post.id}?account=${accountId}`}
                          className="text-sm font-medium text-purple-600 hover:text-purple-700">
                          詳細 →
                        </Link>
                      </td>
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
