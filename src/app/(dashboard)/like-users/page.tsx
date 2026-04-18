'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { IgAccount } from '@/types'
import { InstagramLikeUsersAnalysis } from '@/components/instagram/InstagramLikeUsersAnalysis'

function LikeUsersContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const accountId = searchParams.get('account')
  const [accounts, setAccounts] = useState<IgAccount[]>([])
  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(j => setAccounts(j.data ?? []))
      .catch(() => setAccounts([]))
  }, [])

  const setAccount = (id: string) => {
    const p = new URLSearchParams(searchParams.toString())
    p.set('account', id)
    router.push(`/like-users?${p}`)
  }

  if (!accountId) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">いいねユーザー</h1>
          <p className="text-sm text-gray-500 mt-1">
            手入力インサイトの「いいねユーザー」とフォロワー一覧を突き合わせ、期間内のファン度を一覧します。
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2">Instagram アカウント</label>
          <select
            className="w-full max-w-md border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value=""
            onChange={(e) => {
              if (e.target.value) setAccount(e.target.value)
            }}
          >
            <option value="">選択してください</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_name ?? a.username ?? a.id}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  const currentAccount = accounts.find((a) => a.id === accountId)
  const caption = currentAccount?.username
    ? `@${currentAccount.username}`
    : (currentAccount?.account_name ?? null)

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">いいねユーザー</h1>
          <p className="text-sm text-gray-500 mt-1">
            手入力インサイトの「いいねユーザー」とフォロワー一覧を突き合わせ、期間内のファン度を一覧します。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white min-w-[12rem]"
            value={accountId}
            onChange={(e) => setAccount(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_name ?? a.username ?? a.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <InstagramLikeUsersAnalysis
        accountId={accountId}
        postsListHref={`/posts?account=${accountId}`}
        accountCaption={caption}
      />
    </div>
  )
}

export default function LikeUsersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        </div>
      }
    >
      <LikeUsersContent />
    </Suspense>
  )
}
