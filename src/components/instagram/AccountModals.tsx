'use client'

import { useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// 共通フィールドコンポーネント
// ---------------------------------------------------------------------------
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------
export interface IgAccountWithToken {
  id: string
  platform_account_id: string
  username: string
  account_name: string | null
  account_type: 'BUSINESS' | 'CREATOR'
  biography: string | null
  website: string | null
  facebook_page_id: string | null
  followers_count: number | null
  follows_count: number | null
  media_count: number | null
  profile_picture_url: string | null
  status: 'active' | 'paused' | 'disconnected'
  last_synced_at: string | null
  api_base_url?: string
  api_version?: string
  ig_account_tokens?: Array<{ is_active: boolean; expires_at: string | null; last_verified_at: string | null }>
}

// ---------------------------------------------------------------------------
// アカウント追加モーダル
// ---------------------------------------------------------------------------
export function AddAccountModal({
  onClose,
  onSuccess,
  serviceId,
}: {
  onClose: () => void
  onSuccess: () => void
  serviceId?: string
}) {
  // タブ: 'select'（既存から選択） / 'new'（新規登録）
  const [tab, setTab] = useState<'select' | 'new'>('select')

  // ----- 既存アカウント選択 -----
  const [accounts, setAccounts] = useState<IgAccountWithToken[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== 'select') return
    setAccountsLoading(true)
    fetch('/api/accounts')
      .then(r => r.json())
      .then(json => setAccounts(json.data ?? []))
      .catch(() => setAccounts([]))
      .finally(() => setAccountsLoading(false))
  }, [tab])

  const handleLinkExisting = async () => {
    if (!selectedAccountId || !serviceId) return
    setLinkLoading(true)
    setLinkError(null)
    const res = await fetch(`/api/services/${serviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ig_account_ref_id: selectedAccountId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setLinkError(json.error ?? '紐づけに失敗しました')
      setLinkLoading(false)
      return
    }
    onSuccess()
    onClose()
  }

  // ----- 新規登録 -----
  const [form, setForm] = useState({
    platform_account_id: '',
    username: '',
    account_name: '',
    account_type: 'BUSINESS',
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

    // 1. アカウントを作成
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

    // 2. serviceId が渡されている場合、サービスとアカウントを紐づける
    if (serviceId && json.data?.id) {
      const linkRes = await fetch(`/api/services/${serviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ig_account_ref_id: json.data.id,
          username: form.username,
          display_name: form.account_name || form.username,
        }),
      })
      if (!linkRes.ok) {
        const linkJson = await linkRes.json().catch(() => ({}))
        setError(linkJson.error ?? 'サービスへの紐づけに失敗しました')
        setLoading(false)
        return
      }
    }

    onSuccess()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[min(90vh,900px)] flex flex-col overflow-hidden my-auto">
        {/* ヘッダー */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">アカウントを追加</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* タブ */}
        {serviceId && (
          <div className="flex-shrink-0 flex border-b border-gray-100">
            <button
              type="button"
              onClick={() => setTab('select')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition ${tab === 'select' ? 'text-purple-700 border-b-2 border-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              既存のアカウントを連携
            </button>
            <button
              type="button"
              onClick={() => setTab('new')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition ${tab === 'new' ? 'text-purple-700 border-b-2 border-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              新規登録
            </button>
          </div>
        )}

        {/* 既存アカウント選択タブ */}
        {tab === 'select' && serviceId && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4">
              {accountsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-400">
                  <p>登録済みのアカウントがありません</p>
                  <button
                    type="button"
                    onClick={() => setTab('new')}
                    className="mt-2 text-purple-600 hover:underline"
                  >
                    新規登録はこちら
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400 mb-3">連携するアカウントを選択してください</p>
                  {accounts.map(acc => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => setSelectedAccountId(acc.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition text-left ${
                        selectedAccountId === acc.id
                          ? 'border-purple-400 bg-purple-50'
                          : 'border-gray-200 hover:border-purple-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {acc.profile_picture_url ? (
                          <img src={acc.profile_picture_url} alt={acc.username} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-white text-sm font-bold">{acc.username?.[0]?.toUpperCase() ?? '?'}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">@{acc.username}</p>
                        {acc.account_name && <p className="text-xs text-gray-400 truncate">{acc.account_name}</p>}
                        {acc.followers_count != null && (
                          <p className="text-xs text-gray-400">{acc.followers_count.toLocaleString()} フォロワー</p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        acc.status === 'active' ? 'bg-green-100 text-green-700' :
                        acc.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {acc.status === 'active' ? '有効' : acc.status === 'paused' ? '停止中' : '接続切れ'}
                      </span>
                      {selectedAccountId === acc.id && (
                        <svg className="w-5 h-5 text-purple-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {linkError && (
                <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{linkError}</div>
              )}
            </div>
            <div className="flex-shrink-0 flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/80">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition">
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleLinkExisting}
                disabled={!selectedAccountId || linkLoading}
                className="flex-1 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition disabled:opacity-50"
              >
                {linkLoading ? '連携中...' : '連携する'}
              </button>
            </div>
          </div>
        )}

        {/* 新規登録タブ */}
        {(tab === 'new' || !serviceId) && (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="overflow-y-auto flex-1 min-h-0 px-6 py-6 space-y-4">
              <Field label="Instagram アカウント ID *" hint="プロフィールページのユーザーID（数値）">
                <input type="text" required value={form.platform_account_id}
                  onChange={e => setForm(f => ({ ...f, platform_account_id: e.target.value }))}
                  placeholder="17841400000000000" className="input w-full" />
              </Field>
              <Field label="ユーザー名 *" hint="@なしで入力">
                <input type="text" required value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="your_username" className="input w-full" />
              </Field>
              <Field label="表示名">
                <input type="text" value={form.account_name}
                  onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))}
                  placeholder="アカウント表示名" className="input w-full" />
              </Field>
              <Field label="アカウント種別">
                <select value={form.account_type}
                  onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}
                  className="input w-full">
                  <option value="BUSINESS">ビジネス</option>
                  <option value="CREATOR">クリエイター</option>
                </select>
              </Field>
              <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API 設定</p>
                <Field label="エンドポイント" hint="ビジネス/クリエイター → graph.facebook.com">
                  <select value={form.api_base_url}
                    onChange={e => setForm(f => ({ ...f, api_base_url: e.target.value }))}
                    className="input w-full">
                    <option value="https://graph.facebook.com">graph.facebook.com（推奨）</option>
                    <option value="https://graph.instagram.com">graph.instagram.com（旧 Basic Display）</option>
                  </select>
                </Field>
                <Field label="API バージョン">
                  <select value={form.api_version}
                    onChange={e => setForm(f => ({ ...f, api_version: e.target.value }))}
                    className="input w-full">
                    <option value="v22.0">v22.0（最新推奨）</option>
                    <option value="v21.0">v21.0</option>
                    <option value="v23.0">v23.0（ベータ）</option>
                  </select>
                </Field>
              </div>
              <Field label="Facebook ページ ID" hint="任意。ページ連携時のみ">
                <input type="text" value={form.facebook_page_id}
                  onChange={e => setForm(f => ({ ...f, facebook_page_id: e.target.value }))}
                  placeholder="12345678901234" className="input w-full" />
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
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// アカウント編集モーダル
// ---------------------------------------------------------------------------
export function EditAccountModal({
  account,
  onClose,
  onSuccess,
}: {
  account: IgAccountWithToken
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState({
    platform_account_id: account.platform_account_id,
    username: account.username,
    account_name: account.account_name ?? '',
    account_type: account.account_type,
    biography: account.biography ?? '',
    website: account.website ?? '',
    facebook_page_id: account.facebook_page_id ?? '',
    api_base_url: account.api_base_url ?? 'https://graph.facebook.com',
    api_version: account.api_version ?? 'v22.0',
    status: account.status,
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[min(90vh,900px)] flex flex-col overflow-hidden my-auto">
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">アカウントを編集</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 min-h-0 px-6 py-6 space-y-4">
            <Field label="Instagram アカウント ID">
              <input type="text" required value={form.platform_account_id}
                onChange={e => setForm(f => ({ ...f, platform_account_id: e.target.value }))}
                className="input w-full" />
            </Field>
            <Field label="ユーザー名" hint="@なし">
              <input type="text" required value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className="input w-full" />
            </Field>
            <Field label="表示名">
              <input type="text" value={form.account_name}
                onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))}
                className="input w-full" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="状態">
                <select value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as typeof form.status }))}
                  className="input w-full">
                  <option value="active">有効</option>
                  <option value="paused">停止</option>
                  <option value="disconnected">接続切れ</option>
                </select>
              </Field>
              <Field label="アカウント種別">
                <select value={form.account_type}
                  onChange={e => setForm(f => ({ ...f, account_type: e.target.value as 'BUSINESS' | 'CREATOR' }))}
                  className="input w-full">
                  <option value="BUSINESS">ビジネス</option>
                  <option value="CREATOR">クリエイター</option>
                </select>
              </Field>
            </div>
            <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API 設定</p>
              <Field label="エンドポイント">
                <select value={form.api_base_url}
                  onChange={e => setForm(f => ({ ...f, api_base_url: e.target.value }))}
                  className="input w-full">
                  <option value="https://graph.facebook.com">graph.facebook.com（推奨）</option>
                  <option value="https://graph.instagram.com">graph.instagram.com</option>
                </select>
              </Field>
              <Field label="API バージョン">
                <select value={form.api_version}
                  onChange={e => setForm(f => ({ ...f, api_version: e.target.value }))}
                  className="input w-full">
                  <option value="v22.0">v22.0</option>
                  <option value="v21.0">v21.0</option>
                  <option value="v23.0">v23.0</option>
                </select>
              </Field>
            </div>
            <Field label="Facebook ページ ID" hint="任意">
              <input type="text" value={form.facebook_page_id}
                onChange={e => setForm(f => ({ ...f, facebook_page_id: e.target.value }))}
                className="input w-full" />
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
              {loading ? '保存中...' : '保存する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
