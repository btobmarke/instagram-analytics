'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import type { IgAccount } from '@/types'

interface AccountWithToken extends IgAccount {
  ig_account_tokens?: Array<{ is_active: boolean; expires_at: string | null; last_verified_at: string | null }>
  api_base_url?: string
  api_version?: string
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountWithToken[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [editingApiConfig, setEditingApiConfig] = useState<AccountWithToken | null>(null)

  const fetchAccounts = async () => {
    const res = await fetch('/api/accounts')
    const json = await res.json()
    setAccounts(json.data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchAccounts() }, [])

  const handleSync = async (accountId: string) => {
    setSyncing(accountId)
    setSyncError(null)
    try {
      const res = await fetch(`/api/accounts/${accountId}/sync`, { method: 'POST' })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        details?: { fbtrace_id?: string; step?: string; code?: number }
      }
      if (!res.ok) {
        let msg = typeof json.error === 'string' ? json.error : '同期に失敗しました'
        const d = json.details
        if (d) {
          const lines: string[] = []
          if (d.step) lines.push(`API手順: ${d.step}`)
          if (d.code != null) lines.push(`Meta code: ${d.code}`)
          if (d.fbtrace_id) lines.push(`fbtrace_id: ${d.fbtrace_id}`)
          if (lines.length) msg += `\n\n${lines.join('\n')}`
        }
        setSyncError(msg)
        return
      }
      await fetchAccounts()
    } finally {
      setSyncing(null)
    }
  }

  const handleDelete = async (accountId: string) => {
    if (!confirm('このアカウントを削除しますか？関連データも全て削除されます。')) return
    await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' })
    await fetchAccounts()
  }

  if (loading) return <PageLoader />

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">アカウント管理</h1>
          <p className="text-sm text-gray-500 mt-1">Instagramアカウントを登録・管理します</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          アカウントを追加
        </button>
      </div>

      {syncError && (
        <div
          role="alert"
          className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm"
        >
          <div className="flex justify-between items-start gap-3">
            <p className="font-semibold text-red-900">同期エラー</p>
            <button
              type="button"
              onClick={() => setSyncError(null)}
              className="shrink-0 text-red-600 hover:text-red-800 text-xs font-medium"
            >
              閉じる
            </button>
          </div>
          <pre className="mt-2 text-red-900/90 whitespace-pre-wrap font-sans text-sm leading-relaxed">{syncError}</pre>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-16 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">アカウントが未登録です</h3>
          <p className="text-sm text-gray-500 mb-6">Instagramアカウントを追加して分析を開始しましょう</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 transition"
          >
            最初のアカウントを追加
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {accounts.map((account) => {
            const token = account.ig_account_tokens?.[0]
            const isExpired = token?.expires_at ? new Date(token.expires_at) < new Date() : false
            const statusColor = account.status === 'active' ? 'bg-green-100 text-green-700' :
              account.status === 'paused' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
            const statusLabel = account.status === 'active' ? '有効' : account.status === 'paused' ? '停止中' : '接続切れ'

            return (
              <div key={account.id} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  {/* Profile Picture */}
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {account.profile_picture_url ? (
                      <img src={account.profile_picture_url} alt={account.username} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-white text-xl font-bold">{account.username[0]?.toUpperCase()}</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 text-lg">@{account.username}</h3>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>
                        {statusLabel}
                      </span>
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        {account.account_type}
                      </span>
                      {isExpired && (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-600">
                          トークン期限切れ
                        </span>
                      )}
                    </div>
                    {account.biography && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{account.biography}</p>
                    )}
                    <div className="flex items-center gap-6 mt-3">
                      <Stat label="フォロワー" value={account.followers_count?.toLocaleString() ?? '—'} />
                      <Stat label="フォロー" value={account.follows_count?.toLocaleString() ?? '—'} />
                      <Stat label="投稿数" value={account.media_count?.toLocaleString() ?? '—'} />
                    </div>
                    {/* API設定バッジ */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-mono">
                        {(account as AccountWithToken & { api_base_url?: string }).api_base_url?.replace('https://', '') ?? 'graph.facebook.com'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-mono">
                        {(account as AccountWithToken & { api_version?: string }).api_version ?? 'v22.0'}
                      </span>
                      {account.last_synced_at && (
                        <span className="text-xs text-gray-400">
                          最終同期: {new Date(account.last_synced_at).toLocaleString('ja-JP')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleSync(account.id)}
                      disabled={syncing === account.id}
                      className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition disabled:opacity-50"
                    >
                      {syncing === account.id ? '同期中...' : '同期'}
                    </button>
                    <button
                      onClick={() => setEditingApiConfig(account)}
                      className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      title="アカウント情報・API設定・トークンを編集"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(account.id)}
                      className="px-3 py-2 text-sm font-medium text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAddModal && (
        <AddAccountModal onClose={() => setShowAddModal(false)} onSuccess={fetchAccounts} />
      )}

      {editingApiConfig && (
        <EditAccountModal
          key={editingApiConfig.id}
          account={editingApiConfig}
          onClose={() => setEditingApiConfig(null)}
          onSuccess={fetchAccounts}
        />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-semibold text-gray-800">{value}</p>
    </div>
  )
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
    </div>
  )
}

function AddAccountModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    platform_account_id: '',
    username: '',
    account_name: '',
    account_type: 'BUSINESS',
    access_token: '',
    facebook_page_id: '',
    api_base_url: 'https://graph.facebook.com',
    api_version: 'v22.0',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? '登録に失敗しました')
      setLoading(false)
      return
    }
    onSuccess()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/50">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[min(90vh,900px)] flex flex-col overflow-hidden my-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-account-modal-title"
      >
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id="add-account-modal-title" className="text-lg font-bold text-gray-900">アカウントを追加</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 min-h-0 px-6 py-6 space-y-4">
          <Field label="Instagramアカウント ID *" hint="プロフィールページのIDまたはユーザーID（数値）">
            <input
              type="text" required
              value={form.platform_account_id}
              onChange={e => setForm(f => ({ ...f, platform_account_id: e.target.value }))}
              placeholder="17841400000000000"
              className="input"
            />
          </Field>
          <Field label="ユーザー名 *" hint="@なしで入力">
            <input
              type="text" required
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="your_username"
              className="input"
            />
          </Field>
          <Field label="表示名">
            <input
              type="text"
              value={form.account_name}
              onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))}
              placeholder="アカウント表示名"
              className="input"
            />
          </Field>
          <Field label="アカウント種別">
            <select value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))} className="input">
              <option value="BUSINESS">ビジネス</option>
              <option value="CREATOR">クリエイター</option>
            </select>
          </Field>

          {/* API設定 */}
          <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API設定</p>
            <Field label="エンドポイント" hint="ビジネス/クリエイター→ graph.facebook.com　旧Basic Display → graph.instagram.com">
              <select value={form.api_base_url} onChange={e => setForm(f => ({ ...f, api_base_url: e.target.value }))} className="input">
                <option value="https://graph.facebook.com">graph.facebook.com（推奨）</option>
                <option value="https://graph.instagram.com">graph.instagram.com（旧 Basic Display）</option>
              </select>
            </Field>
            <Field label="APIバージョン">
              <select value={form.api_version} onChange={e => setForm(f => ({ ...f, api_version: e.target.value }))} className="input">
                <option value="v22.0">v22.0（最新推奨）</option>
                <option value="v21.0">v21.0</option>
                <option value="v23.0">v23.0（ベータ）</option>
              </select>
            </Field>
          </div>

          <Field label="アクセストークン *" hint="Instagram Graph APIの長期トークン">
            <textarea
              required
              rows={3}
              value={form.access_token}
              onChange={e => setForm(f => ({ ...f, access_token: e.target.value }))}
              placeholder="EAAxxxxxxxxxx..."
              className="input resize-none"
            />
          </Field>
          <Field label="FacebookページID" hint="任意。ページ連携時のみ">
            <input
              type="text"
              value={form.facebook_page_id}
              onChange={e => setForm(f => ({ ...f, facebook_page_id: e.target.value }))}
              placeholder="12345678901234"
              className="input"
            />
          </Field>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
          )}
          </div>

          <div className="flex-shrink-0 flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/80">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition">
              キャンセル
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition disabled:opacity-60">
              {loading ? '登録中...' : '登録する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditAccountModal({
  account,
  onClose,
  onSuccess,
}: {
  account: AccountWithToken
  onClose: () => void
  onSuccess: () => void
}) {
  const apiBase = (account as AccountWithToken & { api_base_url?: string }).api_base_url
  const apiVer = (account as AccountWithToken & { api_version?: string }).api_version

  const [form, setForm] = useState({
    platform_account_id: account.platform_account_id,
    username: account.username,
    account_name: account.account_name ?? '',
    account_type: account.account_type,
    biography: account.biography ?? '',
    website: account.website ?? '',
    facebook_page_id: account.facebook_page_id ?? '',
    api_base_url: apiBase ?? 'https://graph.facebook.com',
    api_version: apiVer ?? 'v22.0',
    status: account.status,
    access_token: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const body: Record<string, unknown> = {
      platform_account_id: form.platform_account_id,
      username: form.username,
      account_name: form.account_name || null,
      account_type: form.account_type,
      biography: form.biography || null,
      website: form.website || null,
      facebook_page_id: form.facebook_page_id || null,
      api_base_url: form.api_base_url,
      api_version: form.api_version,
      status: form.status,
    }
    if (form.access_token.trim()) {
      body.access_token = form.access_token.trim()
    }
    const res = await fetch(`/api/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(typeof json.error === 'string' ? json.error : '更新に失敗しました')
      setLoading(false)
      return
    }
    onSuccess()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/50">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[min(90vh,900px)] flex flex-col overflow-hidden my-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-account-modal-title"
      >
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id="edit-account-modal-title" className="text-lg font-bold text-gray-900">アカウントを編集</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 min-h-0 px-6 py-6 space-y-4">
            <Field label="Instagramアカウント ID" hint="Graph API の IG User ID（数値）">
              <input
                type="text"
                required
                value={form.platform_account_id}
                onChange={e => setForm(f => ({ ...f, platform_account_id: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="ユーザー名" hint="@なし">
              <input
                type="text"
                required
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="表示名">
              <input
                type="text"
                value={form.account_name}
                onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="状態">
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as typeof form.status }))}
                className="input"
              >
                <option value="active">有効</option>
                <option value="paused">停止</option>
                <option value="disconnected">接続切れ</option>
              </select>
            </Field>
            <Field label="アカウント種別">
              <select
                value={form.account_type}
                onChange={e => setForm(f => ({ ...f, account_type: e.target.value as 'BUSINESS' | 'CREATOR' }))}
                className="input"
              >
                <option value="BUSINESS">ビジネス</option>
                <option value="CREATOR">クリエイター</option>
              </select>
            </Field>
            <Field label="自己紹介（biography）">
              <textarea
                rows={2}
                value={form.biography}
                onChange={e => setForm(f => ({ ...f, biography: e.target.value }))}
                className="input resize-y min-h-[3rem]"
              />
            </Field>
            <Field label="Webサイト">
              <input
                type="url"
                value={form.website}
                onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                className="input"
              />
            </Field>

            <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API設定</p>
              <Field label="エンドポイント">
                <select
                  value={form.api_base_url}
                  onChange={e => setForm(f => ({ ...f, api_base_url: e.target.value }))}
                  className="input"
                >
                  <option value="https://graph.facebook.com">graph.facebook.com（推奨）</option>
                  <option value="https://graph.instagram.com">graph.instagram.com</option>
                </select>
              </Field>
              <Field label="APIバージョン">
                <select
                  value={form.api_version}
                  onChange={e => setForm(f => ({ ...f, api_version: e.target.value }))}
                  className="input"
                >
                  <option value="v22.0">v22.0</option>
                  <option value="v21.0">v21.0</option>
                  <option value="v23.0">v23.0</option>
                </select>
              </Field>
            </div>

            <Field label="FacebookページID" hint="任意">
              <input
                type="text"
                value={form.facebook_page_id}
                onChange={e => setForm(f => ({ ...f, facebook_page_id: e.target.value }))}
                className="input"
              />
            </Field>

            <Field
              label="アクセストークン"
              hint="空欄のままならトークンは変更しません。再発行した長期トークンを貼り付けて更新できます。"
            >
              <textarea
                rows={3}
                value={form.access_token}
                onChange={e => setForm(f => ({ ...f, access_token: e.target.value }))}
                placeholder="変更する場合のみ入力"
                className="input resize-none"
              />
            </Field>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
            )}
          </div>

          <div className="flex-shrink-0 flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/80">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition disabled:opacity-60"
            >
              {loading ? '保存中...' : '保存する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}
