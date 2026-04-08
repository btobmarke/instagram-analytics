'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import type { ClientDetail } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface GbpCredentialInfo {
  id: string
  auth_status: 'pending' | 'active' | 'revoked' | 'error'
  google_account_email: string | null
}

export default function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [activeTab, setActiveTab] = useState<'projects' | 'settings'>('projects')

  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: ClientDetail }>(
    `/api/clients/${clientId}`,
    fetcher
  )

  const client = data?.data

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !client) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          クライアント情報の取得に失敗しました
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link href="/clients" className="hover:text-purple-600">クライアント一覧</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-700 font-medium">{client.client_name}</span>
      </nav>

      {/* クライアントヘッダー */}
      <div className="flex items-center gap-4 mb-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center flex-shrink-0">
          <span className="text-purple-700 font-bold text-xl">
            {client.client_name.charAt(0)}
          </span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{client.client_name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            登録日: {new Date(client.created_at).toLocaleDateString('ja-JP')}
          </p>
        </div>
      </div>

      {/* タブナビ */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('projects')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
            activeTab === 'projects'
              ? 'text-purple-600 border-purple-600'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          }`}
        >
          プロジェクト一覧
          <span className="ml-1.5 text-xs text-gray-400">{client.projects.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
            activeTab === 'settings'
              ? 'text-purple-600 border-purple-600'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          }`}
        >
          設定
        </button>
      </div>

      {/* ── プロジェクト一覧タブ ── */}
      {activeTab === 'projects' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-500">
              {client.projects.length}件のプロジェクト
            </h2>
            <button
              onClick={() => setShowCreateProject(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新規プロジェクト
            </button>
          </div>

          {client.projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400">
              <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-sm">プロジェクトがありません</p>
              <button
                onClick={() => setShowCreateProject(true)}
                className="mt-2 text-purple-600 text-sm font-medium hover:underline"
              >
                最初のプロジェクトを追加する
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {client.projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-purple-200 transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900 group-hover:text-purple-700 transition-colors">
                        {project.project_name}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        サービス {project.service_count}件
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-purple-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  {project.note && (
                    <p className="text-xs text-gray-500 mt-3 line-clamp-2">{project.note}</p>
                  )}
                  <p className="text-xs text-gray-300 mt-3">
                    登録: {new Date(project.created_at).toLocaleDateString('ja-JP')}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── 設定タブ ── */}
      {activeTab === 'settings' && (
        <>
          {/* クライアント基本情報 */}
          {client.note && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">備考</h3>
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-3">{client.note}</p>
            </div>
          )}

          {/* GBP 連携設定 */}
          <GbpCredentialSection clientId={clientId} />

          {/* LINE OAM セッション設定 */}
          <LineOamSessionSection clientId={clientId} />
        </>
      )}

      {/* Create Project Modal */}
      {showCreateProject && (
        <CreateProjectModal
          clientId={clientId}
          onClose={() => setShowCreateProject(false)}
          onCreated={() => { setShowCreateProject(false); mutate() }}
        />
      )}
    </div>
  )
}

function CreateProjectModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [projectName, setProjectName] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectName.trim()) { setError('プロジェクト名を入力してください'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, project_name: projectName.trim(), note: note.trim() || undefined }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error?.message ?? '登録に失敗しました'); return }
      onCreated()
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">新規プロジェクト登録</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">プロジェクト名 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="例: 新商品LP施策2025"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
              maxLength={255}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="任意のメモを入力"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
              maxLength={1000}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              キャンセル
            </button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-60">
              {loading ? '登録中...' : '登録する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// LINE OAM セッション設定セクション
// --------------------------------------------------------------------------
interface LineOamSession {
  id: string
  client_id: string
  label: string | null
  status: 'active' | 'revoked'
  last_used_at: string | null
  created_at: string
  updated_at: string
  has_passphrase: boolean
}

function LineOamSessionSection({ clientId }: { clientId: string }) {
  const { data: sessionData, mutate: mutateSession } = useSWR<{ success: boolean; data: LineOamSession | null }>(
    `/api/clients/${clientId}/line-oam/session`, fetcher
  )
  const session = sessionData?.data

  const [showForm, setShowForm] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // JSON を解析して暗号化バンドルを取得
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonText.trim())
    } catch {
      setError('JSON の形式が正しくありません')
      return
    }

    if (!parsed.kdf || !parsed.nonce_b64 || !parsed.ciphertext_b64) {
      setError('必須フィールド (kdf, nonce_b64, ciphertext_b64) が見つかりません')
      return
    }

    setSaving(true)
    const body: Record<string, unknown> = { ...parsed }
    if (passphrase.trim()) body.passphrase = passphrase.trim()
    if (label.trim()) body.label = label.trim()

    const res = await fetch(`/api/clients/${clientId}/line-oam/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.success) { setError(json.error ?? '保存に失敗しました'); setSaving(false); return }
    setShowForm(false)
    setJsonText('')
    setPassphrase('')
    setLabel('')
    setSaving(false)
    mutateSession()
  }

  const handleRevoke = async () => {
    if (!confirm('LINE OAMセッションを無効化しますか？')) return
    await fetch(`/api/clients/${clientId}/line-oam/session`, { method: 'DELETE' })
    mutateSession()
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-lg">💬</div>
          <h2 className="font-bold text-gray-900">LINE OAM セッション設定</h2>
        </div>
        {session && session.status === 'active' && (
          <button onClick={handleRevoke} className="text-xs text-gray-400 hover:text-red-500 transition">
            無効化
          </button>
        )}
      </div>

      {/* 未登録 or 無効化済み */}
      {(!session || session.status === 'revoked') && !showForm && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">
            LINE OAM バッチを動かすには、暗号化済み storage_state を登録してください
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition"
          >
            セッションを登録
          </button>
        </div>
      )}

      {/* 登録済み（active） */}
      {session && session.status === 'active' && !showForm && (
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                有効
              </span>
              <div>
                {session.label && (
                  <p className="text-sm font-medium text-gray-700">{session.label}</p>
                )}
                <p className="text-xs text-gray-400">
                  登録: {new Date(session.created_at).toLocaleDateString('ja-JP')}
                  {session.last_used_at && (
                    <> / 最終使用: {new Date(session.last_used_at).toLocaleDateString('ja-JP')}</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {session.has_passphrase && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  🔑 パスフレーズ登録済み
                </span>
              )}
              <button
                onClick={() => setShowForm(true)}
                className="text-xs text-gray-400 hover:text-green-600 transition"
              >
                更新
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 登録フォーム */}
      {showForm && (
        <form onSubmit={handleSave} className="space-y-4 mt-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              暗号化バンドル JSON <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-1">
              Python スクリプトで出力した JSON をそのまま貼り付けてください（kdf, nonce_b64, ciphertext_b64 を含むオブジェクト）
            </p>
            <textarea
              rows={6}
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder={'{\n  "format_version": 1,\n  "cipher": "AES-256-GCM",\n  "kdf": "PBKDF2-HMAC-SHA256",\n  "nonce_b64": "...",\n  "ciphertext_b64": "..."\n}'}
              className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              パスフレーズ（無人バッチ用・任意）
            </label>
            <p className="text-xs text-gray-400 mb-1">
              登録するとサーバー側に KEK 暗号化して保存され、無人バッチ実行時に自動的に使用されます
            </p>
            <input
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              placeholder="パスフレーズ（省略可）"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ラベル（任意）</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="例: 本番セッション 2025-01"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setShowForm(false); setError('') }}
              className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              キャンセル
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 transition">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// GBP 連携設定セクション
// --------------------------------------------------------------------------
function GbpCredentialSection({ clientId }: { clientId: string }) {
  const { data: credData, mutate: mutateCred } = useSWR<{ success: boolean; data: GbpCredentialInfo | null }>(
    `/api/clients/${clientId}/gbp/credential`, fetcher
  )
  const credential = credData?.data

  const [showForm, setShowForm] = useState(false)
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!oauthClientId.trim() || !oauthClientSecret.trim()) {
      setError('Client ID と Client Secret の両方を入力してください')
      return
    }
    setSaving(true)
    setError('')
    const res = await fetch(`/api/clients/${clientId}/gbp/credential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oauth_client_id:     oauthClientId.trim(),
        oauth_client_secret: oauthClientSecret.trim(),
      }),
    })
    const json = await res.json()
    if (!json.success) { setError(json.error ?? '保存に失敗しました'); setSaving(false); return }
    setShowForm(false)
    setOauthClientId('')
    setOauthClientSecret('')
    setSaving(false)
    mutateCred()
  }

  const handleDelete = async () => {
    if (!confirm('GBP連携設定を削除しますか？OAuth認証情報もすべて削除されます。')) return
    await fetch(`/api/clients/${clientId}/gbp/credential`, { method: 'DELETE' })
    mutateCred()
  }

  const statusLabel = (s: string) => {
    switch (s) {
      case 'active':  return { text: '連携済み', color: 'bg-green-100 text-green-700' }
      case 'pending': return { text: 'OAuth未完了', color: 'bg-yellow-100 text-yellow-700' }
      case 'error':   return { text: '要再連携', color: 'bg-red-100 text-red-700' }
      case 'revoked': return { text: '解除済み', color: 'bg-gray-100 text-gray-500' }
      default:        return { text: s, color: 'bg-gray-100 text-gray-500' }
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-100 to-green-100 flex items-center justify-center text-lg">🏢</div>
          <h2 className="font-bold text-gray-900">GBP 連携設定</h2>
        </div>
        {credential && (
          <button onClick={handleDelete} className="text-xs text-gray-400 hover:text-red-500 transition">
            設定を削除
          </button>
        )}
      </div>

      {/* 未登録状態 */}
      {!credential && !showForm && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">
            GBPデータを取得するにはGoogle OAuthクライアント情報の登録が必要です
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 text-sm font-medium text-teal-700 border border-teal-300 rounded-lg hover:bg-teal-50 transition"
          >
            GBP OAuth設定を登録
          </button>
        </div>
      )}

      {/* 登録フォーム */}
      {(showForm || (!credential && false)) && (
        <form onSubmit={handleSave} className="space-y-3 mt-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Google OAuth Client ID</label>
            <input
              type="text"
              value={oauthClientId}
              onChange={e => setOauthClientId(e.target.value)}
              placeholder="123456789-xxxxxxxxx.apps.googleusercontent.com"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Google OAuth Client Secret</label>
            <input
              type="password"
              value={oauthClientSecret}
              onChange={e => setOauthClientSecret(e.target.value)}
              placeholder="GOCSPX-xxxxxxxxx"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              キャンセル
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60 transition">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      )}

      {/* 登録済み状態 */}
      {credential && (
        <div className="space-y-3">
          {/* ステータス */}
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusLabel(credential.auth_status).color}`}>
                {statusLabel(credential.auth_status).text}
              </span>
              {credential.google_account_email && (
                <span className="text-sm text-gray-600">{credential.google_account_email}</span>
              )}
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="text-xs text-gray-400 hover:text-teal-600 transition"
            >
              Client ID/Secretを変更
            </button>
          </div>

          {/* OAuth認証ボタン（未完了 or エラー or 解除済みの場合） */}
          {credential.auth_status !== 'active' && (
            <a
              href={`/api/clients/${clientId}/gbp/auth`}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-white border-2 border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:border-teal-400 hover:text-teal-700 transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Googleアカウントと連携する
            </a>
          )}

          {/* 連携済みの場合 */}
          {credential.auth_status === 'active' && (
            <div className="flex items-center gap-2">
              <a
                href={`/api/clients/${clientId}/gbp/auth`}
                className="text-xs text-gray-400 hover:text-teal-600 transition"
              >
                再認証する
              </a>
            </div>
          )}

          {/* 入力フォーム（変更用） */}
          {showForm && (
            <form onSubmit={handleSave} className="space-y-3 border-t border-gray-100 pt-3 mt-3">
              <p className="text-xs text-gray-400">OAuth クライアント情報を更新します</p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Google OAuth Client ID</label>
                <input
                  type="text"
                  value={oauthClientId}
                  onChange={e => setOauthClientId(e.target.value)}
                  placeholder="123456789-xxxxxxxxx.apps.googleusercontent.com"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Google OAuth Client Secret</label>
                <input
                  type="password"
                  value={oauthClientSecret}
                  onChange={e => setOauthClientSecret(e.target.value)}
                  placeholder="GOCSPX-xxxxxxxxx"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                  キャンセル
                </button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60 transition">
                  {saving ? '保存中...' : '更新'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
