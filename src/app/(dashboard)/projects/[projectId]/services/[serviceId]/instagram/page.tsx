'use client'

import { useState, use, useCallback } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { AddAccountModal, EditAccountModal, type IgAccountWithToken } from '@/components/instagram/AccountModals'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  service_type: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
  type_config: {
    id?: string
    ig_account_ref_id?: string
    username?: string
    display_name?: string
    status?: string
  } | null
}

// ---------------------------------------------------------------------------
// トークン有効期限バッジ
// ---------------------------------------------------------------------------
function TokenBadge({ token }: { token?: { is_active: boolean; expires_at: string | null } }) {
  if (!token) return <span className="text-xs text-gray-400">トークン未登録</span>
  if (!token.is_active) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />無効
    </span>
  )
  if (token.expires_at) {
    const daysLeft = Math.ceil((new Date(token.expires_at).getTime() - Date.now()) / 86400000)
    if (daysLeft < 0) return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />期限切れ
      </span>
    )
    if (daysLeft <= 14) return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />残{daysLeft}日
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />有効
    </span>
  )
}

// ---------------------------------------------------------------------------
// メインページ
// ---------------------------------------------------------------------------
export default function InstagramServicePage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // サービス情報取得
  const { data: serviceData, mutate: mutateService } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = serviceData?.data
  const igAccountRefId = service?.type_config?.ig_account_ref_id

  // アカウント詳細取得（連携済みの場合）
  // GET /api/accounts/[id] は { data: IgAccountWithToken } を返すので .data を取り出す
  const { data: accountData, mutate: mutateAccount } = useSWR<{ data: IgAccountWithToken }>(
    igAccountRefId ? `/api/accounts/${igAccountRefId}` : null,
    fetcher
  )
  const account = accountData?.data

  const refreshAll = useCallback(async () => {
    // まずサービス情報を再取得し、ig_account_ref_id が確定してからアカウントも再取得
    await mutateService()
    mutateAccount()
  }, [mutateService, mutateAccount])

  const handleSync = async () => {
    if (!igAccountRefId) return
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch(`/api/accounts/${igAccountRefId}/sync`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        let msg = typeof json.error === 'string' ? json.error : '同期に失敗しました'
        const d = json.details
        if (d) {
          const lines: string[] = []
          if (d.step) lines.push(`API手順: ${d.step}`)
          if (d.code != null) lines.push(`Meta code: ${d.code}`)
          if (d.fbtrace_id) lines.push(`fbtrace_id: ${d.fbtrace_id}`)
          if (lines.length) msg += `\n${lines.join('\n')}`
        }
        setSyncError(msg)
        return
      }
      await refreshAll()
    } finally {
      setSyncing(false)
    }
  }

  if (!serviceData) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  const token = account?.ig_account_tokens?.[0]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/clients" className="hover:text-purple-600">クライアント一覧</Link>
        <span>›</span>
        <Link href={`/clients/${service?.client.id}`} className="hover:text-purple-600">
          {service?.client.client_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">
          {service?.project.project_name}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">{service?.service_name ?? 'Instagram'}</span>
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
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          投稿一覧
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/ai`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          AI分析
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram`}
          className="px-4 py-2.5 text-sm font-medium text-pink-600 border-b-2 border-pink-600 -mb-px"
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

      {/* ================================================================ */}
      {/* アカウント情報ヘッダー                                            */}
      {/* ================================================================ */}
      {account ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          {/* プロフィール */}
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {account.profile_picture_url ? (
                <img src={account.profile_picture_url} alt={account.username} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-2xl font-bold">{account.username?.[0]?.toUpperCase() ?? '?'}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">@{account.username}</h1>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  account.status === 'active' ? 'bg-green-100 text-green-700' :
                  account.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {account.status === 'active' ? '有効' : account.status === 'paused' ? '停止中' : '接続切れ'}
                </span>
                <TokenBadge token={token} />
              </div>
              {account.biography && (
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{account.biography}</p>
              )}
              {/* フォロワー数等 */}
              <div className="flex items-center gap-6 mt-3">
                {[
                  { label: 'フォロワー', val: account.followers_count },
                  { label: 'フォロー中', val: account.follows_count },
                  { label: '投稿数', val: account.media_count },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="text-sm font-bold text-gray-800">{val?.toLocaleString() ?? '—'}</p>
                  </div>
                ))}
                {account.last_synced_at && (
                  <div className="ml-auto text-right">
                    <p className="text-xs text-gray-400">最終同期</p>
                    <p className="text-xs text-gray-500">{new Date(account.last_synced_at).toLocaleString('ja-JP')}</p>
                  </div>
                )}
              </div>
            </div>
            {/* アクション */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-purple-600 hover:bg-purple-50 border border-gray-200 rounded-lg transition disabled:opacity-50"
              >
                {syncing ? (
                  <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                同期
              </button>
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 border border-gray-200 rounded-lg transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                編集
              </button>
            </div>
          </div>

          {/* 同期エラー */}
          {syncError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <div className="flex justify-between items-start">
                <p className="font-semibold">同期エラー</p>
                <button onClick={() => setSyncError(null)} className="text-red-400 hover:text-red-600 text-xs">閉じる</button>
              </div>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{syncError}</pre>
            </div>
          )}
        </div>
      ) : (
        /* 未連携バナー */
        <div className="bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-200 rounded-2xl p-6 mb-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center mx-auto mb-4 text-3xl">
            📸
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-1">Instagram アカウントが未連携です</h2>
          <p className="text-sm text-gray-500 mb-4">
            アカウントを登録することでインサイト・投稿分析が利用できます
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition"
          >
            アカウントを連携する
          </button>
        </div>
      )}

      {/* ================================================================ */}
      {/* アカウント設定（折りたたみ）                                      */}
      {/* ================================================================ */}
      {account && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              アカウント設定
            </span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${settingsOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {settingsOpen && (
            <div className="border-t border-gray-100 px-5 py-4 space-y-4">
              {/* API設定 */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400 mb-0.5">エンドポイント</p>
                  <p className="font-mono text-gray-700">{account.api_base_url?.replace('https://', '') ?? 'graph.facebook.com'}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400 mb-0.5">API バージョン</p>
                  <p className="font-mono text-gray-700">{account.api_version ?? 'v22.0'}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400 mb-0.5">アクセストークン</p>
                  <div className="flex items-center gap-1.5">
                    <TokenBadge token={token} />
                    {token?.expires_at && (
                      <span className="text-gray-500">{new Date(token.expires_at).toLocaleDateString('ja-JP')}まで</span>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400 mb-0.5">アカウント種別</p>
                  <p className="text-gray-700">{account.account_type}</p>
                </div>
              </div>
              {/* ダンジャーゾーン */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-red-500 mb-2">危険ゾーン</p>
                <p className="text-xs text-gray-400 mb-3">アカウントを削除するとすべての収集データも削除されます。</p>
                <button
                  onClick={async () => {
                    if (!confirm('アカウントを削除しますか？関連データもすべて削除されます。')) return
                    await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
                    refreshAll()
                  }}
                  className="px-4 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition"
                >
                  アカウントを削除
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* モーダル */}
      {showAddModal && (
        <AddAccountModal
          serviceId={serviceId}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); refreshAll() }}
        />
      )}
      {showEditModal && account && (
        <EditAccountModal
          account={account}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => { setShowEditModal(false); refreshAll() }}
        />
      )}
    </div>
  )
}
