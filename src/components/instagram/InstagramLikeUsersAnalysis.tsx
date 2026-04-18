'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { FollowerListImportPanel } from '@/components/instagram/FollowerListImportPanel'

export type LikeUserRow = { username: string; like_count: number; is_follower: boolean }

export type LikeUsersMeta = {
  window_days: number
  posts_in_window: number
  posts_with_likers: number
  followers_list_count: number
}

type InstagramLikeUsersAnalysisProps = {
  accountId: string
  postsListHref: string
  accountCaption?: string | null
  embedded?: boolean
  /** サービス詳細まわりでは true（フォロワー取り込みは設定画面のモーダルから） */
  hideFollowerImport?: boolean
}

export function InstagramLikeUsersAnalysis({
  accountId,
  postsListHref,
  accountCaption,
  embedded = false,
  hideFollowerImport = false,
}: InstagramLikeUsersAnalysisProps) {
  const [days, setDays] = useState<1 | 7 | 30>(7)
  const [rows, setRows] = useState<LikeUserRow[]>([])
  const [meta, setMeta] = useState<LikeUsersMeta | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchLikeUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/instagram/like-users?account=${accountId}&days=${days}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRows([])
        setMeta(null)
        return
      }
      setRows(j.data ?? [])
      setMeta(j.meta ?? null)
    } finally {
      setLoading(false)
    }
  }, [accountId, days])

  useEffect(() => {
    void fetchLikeUsers()
  }, [fetchLikeUsers])

  const tableMaxH = embedded ? 'max-h-[min(50vh,420px)]' : 'max-h-[min(70vh,720px)]'

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">いいねユーザー</h2>
            <p className="text-sm text-gray-500 mt-1">
              過去1年のうち、<strong>投稿日が直近 {days} 日以内</strong>の投稿に紐づく手入力「いいねユーザー」を集計しています。
            </p>
          </div>
          <Link
            href={postsListHref}
            className="text-sm font-medium text-purple-600 hover:text-purple-700 whitespace-nowrap self-start sm:self-center"
          >
            投稿一覧 →
          </Link>
        </div>
      )}

      {embedded && (
        <p className="text-xs text-gray-500">
          過去1年のうち、<strong>投稿日が直近 {days} 日以内</strong>の投稿に紐づく手入力「いいねユーザー」を集計しています。
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {([1, 7, 30] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition ${
              days === d
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            直近{d}日の投稿
          </button>
        ))}
      </div>

      {meta && (
        <div className="flex flex-wrap gap-4 text-sm text-gray-600 bg-white rounded-xl border border-gray-200 px-4 py-3">
          <span>
            対象投稿: <strong className="text-gray-900">{meta.posts_in_window.toLocaleString()}</strong> 件
          </span>
          <span>
            いいねリストあり: <strong className="text-gray-900">{meta.posts_with_likers.toLocaleString()}</strong> 投稿
          </span>
          <span>
            フォロワーDB: <strong className="text-gray-900">{meta.followers_list_count.toLocaleString()}</strong> 名
          </span>
        </div>
      )}

      {!hideFollowerImport && (
        <FollowerListImportPanel accountId={accountId} onImported={() => void fetchLikeUsers()} />
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">
            ユーザー一覧
            {accountCaption ? <span className="font-normal text-gray-500 ml-2">（{accountCaption}）</span> : null}
          </h3>
          {loading && <span className="text-xs text-gray-400">読み込み中…</span>}
        </div>
        <div className={`overflow-x-auto overflow-y-auto ${tableMaxH}`}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10 shadow-sm">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">ユーザー名</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 tabular-nums">いいね回数</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">フォロワー</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-gray-500">
                    該当ユーザーがいません。対象期間の投稿に、手入力の「いいねユーザー」が登録されているか確認してください。
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.username} className="hover:bg-gray-50/80">
                  <td className="px-4 py-2.5 font-mono text-gray-900">@{r.username}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">{r.like_count}</td>
                  <td className="px-4 py-2.5">
                    {r.is_follower ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        フォロワー
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        フォロワー以外
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
