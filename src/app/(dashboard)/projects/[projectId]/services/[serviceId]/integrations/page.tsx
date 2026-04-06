'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR, { mutate } from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type IntegrationType = 'GA4' | 'CLARITY'

interface Integration {
  id: string
  service_id: string
  integration_type: IntegrationType
  external_project_id: string
  last_synced_at: string | null
  status: 'active' | 'error' | 'inactive'
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// ステータスバッジ
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: Integration['status'] }) {
  const map = {
    active: { label: '連携中', cls: 'bg-green-100 text-green-700' },
    error: { label: 'エラー', cls: 'bg-red-100 text-red-700' },
    inactive: { label: '無効', cls: 'bg-gray-100 text-gray-500' },
  }
  const { label, cls } = map[status] ?? map.inactive
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
}

// ---------------------------------------------------------------------------
// GA4 設定フォーム
// ---------------------------------------------------------------------------
function GA4Form({
  serviceId,
  existing,
  onClose,
}: {
  serviceId: string
  existing: Integration | undefined
  onClose: () => void
}) {
  const [propertyId, setPropertyId] = useState(existing?.external_project_id ?? '')
  const [saJson, setSaJson] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/services/${serviceId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integration_type: 'GA4',
          property_id: propertyId,
          service_account_json: saJson,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? '保存に失敗しました')
      await mutate(`/api/services/${serviceId}/integrations`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          GA4 プロパティ ID <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={propertyId}
          onChange={e => setPropertyId(e.target.value)}
          placeholder="例: 123456789"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
          required
        />
        <p className="text-xs text-gray-400 mt-1">GA4 管理画面 → プロパティ設定 に表示される数字 ID</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          サービスアカウント JSON <span className="text-red-500">*</span>
        </label>
        <textarea
          value={saJson}
          onChange={e => setSaJson(e.target.value)}
          placeholder='{"type":"service_account","project_id":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...","client_email":"xxx@xxx.iam.gserviceaccount.com",...}'
          rows={6}
          className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none"
          required={!existing}
        />
        {existing && (
          <p className="text-xs text-amber-600 mt-1">
            ※ 更新する場合のみ入力。空欄の場合は既存の認証情報を維持します（現在の実装では再入力が必要です）
          </p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          Google Cloud Console → サービスアカウント → キーを追加 → JSON でダウンロードしたファイルの内容を貼り付け
        </p>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          キャンセル
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Clarity 設定フォーム
// ---------------------------------------------------------------------------
function ClarityForm({
  serviceId,
  existing,
  onClose,
}: {
  serviceId: string
  existing: Integration | undefined
  onClose: () => void
}) {
  const [projectId, setProjectId] = useState(existing?.external_project_id ?? '')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/services/${serviceId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integration_type: 'CLARITY',
          project_id: projectId,
          api_key: apiKey,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? '保存に失敗しました')
      await mutate(`/api/services/${serviceId}/integrations`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          プロジェクト ID <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          placeholder="例: abcd1234efgh"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
          required
        />
        <p className="text-xs text-gray-400 mt-1">Clarity ダッシュボード → 設定 → プロジェクト ID</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          API キー <span className="text-red-500">*</span>
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={existing ? '変更する場合のみ入力' : 'API キーを入力'}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
          required={!existing}
        />
        <p className="text-xs text-gray-400 mt-1">
          Clarity ダッシュボード → 設定 → API アクセス → キーを生成
        </p>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          キャンセル
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// 連携カード
// ---------------------------------------------------------------------------
function IntegrationCard({
  type,
  existing,
  serviceId,
}: {
  type: IntegrationType
  existing: Integration | undefined
  serviceId: string
}) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isGA4 = type === 'GA4'
  const accent = isGA4 ? 'orange' : 'blue'
  const icon = isGA4 ? (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#F57C00" />
      <path d="M12 4v16M6 8l6-4 6 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#0078D4" />
      <path d="M5 17l4-8 3 5 2-3 5 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  const handleDelete = async () => {
    if (!existing || !confirm(`${type} の連携設定を削除しますか？`)) return
    setDeleting(true)
    try {
      await fetch(`/api/services/${serviceId}/integrations?type=${type}`, { method: 'DELETE' })
      await mutate(`/api/services/${serviceId}/integrations`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 p-5 border-b border-gray-100">
        {icon}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">
              {isGA4 ? 'Google Analytics 4' : 'Microsoft Clarity'}
            </h3>
            {existing && <StatusBadge status={existing.status} />}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {isGA4
              ? 'セッション・PV・CV・トラフィックソース・デバイス・地域データを収集'
              : 'セッション・スクロール深度・レイジクリック・デッドクリック・JS エラーを収集'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {existing && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
            >
              {deleting ? '削除中...' : '削除'}
            </button>
          )}
          <button
            onClick={() => setOpen(v => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              existing
                ? 'text-gray-600 border border-gray-200 hover:bg-gray-50'
                : `text-white bg-${accent}-500 hover:bg-${accent}-600`
            }`}
            style={!existing ? { backgroundColor: isGA4 ? '#F57C00' : '#0078D4' } : undefined}
          >
            {existing ? '編集' : '設定する'}
          </button>
        </div>
      </div>

      {/* 設定済み情報 */}
      {existing && !open && (
        <div className="px-5 py-3 bg-gray-50 text-xs text-gray-500 flex flex-wrap gap-4">
          <span>
            <span className="font-medium">{isGA4 ? 'プロパティ ID' : 'プロジェクト ID'}:</span>{' '}
            {existing.external_project_id}
          </span>
          {existing.last_synced_at && (
            <span>
              <span className="font-medium">最終取得:</span>{' '}
              {new Date(existing.last_synced_at).toLocaleString('ja-JP')}
            </span>
          )}
        </div>
      )}

      {/* フォーム */}
      {open && (
        <div className="p-5">
          {isGA4 ? (
            <GA4Form serviceId={serviceId} existing={existing} onClose={() => setOpen(false)} />
          ) : (
            <ClarityForm serviceId={serviceId} existing={existing} onClose={() => setOpen(false)} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// メインページ
// ---------------------------------------------------------------------------
export default function ServiceIntegrationsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data, isLoading } = useSWR<{ success: boolean; data: Integration[] }>(
    `/api/services/${serviceId}/integrations`,
    fetcher
  )

  const integrations = data?.data ?? []
  const ga4 = integrations.find(i => i.integration_type === 'GA4')
  const clarity = integrations.find(i => i.integration_type === 'CLARITY')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/projects/${projectId}`}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">外部連携設定</h1>
          <p className="text-sm text-gray-500 mt-0.5">GA4・Clarity との連携を設定します</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <IntegrationCard type="GA4" existing={ga4} serviceId={serviceId} />
          <IntegrationCard type="CLARITY" existing={clarity} serviceId={serviceId} />
        </div>
      )}

      {/* 注意書き */}
      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 space-y-1">
        <p className="font-medium">データ収集について</p>
        <p>設定後、バッチ管理画面から「GA4収集」「Clarity収集」バッチを手動実行するか、毎日自動実行されます。</p>
        <p>取得したデータはすべて生データとして保存され、分析画面で自由に参照できます。</p>
      </div>
    </div>
  )
}
