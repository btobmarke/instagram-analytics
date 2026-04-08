'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ---------- 型 ----------
interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
}

interface GbpCredential {
  id: string
  auth_status: 'active' | 'revoked' | 'error' | 'pending'
  google_account_email: string | null
  scopes: string | null
  updated_at: string
}

interface GbpSite {
  id: string
  service_id: string
  gbp_location_name: string
  gbp_title: string | null
  is_active: boolean
  last_synced_at: string | null
}

interface GbpLocation {
  name: string
  title: string
  accountName?: string
}

// ---------- ロケーション選択モーダル ----------
function LocationSelectModal({
  serviceId,
  onClose,
  onSaved,
}: {
  serviceId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { data: locData, isLoading } = useSWR<{ success: boolean; data: GbpLocation[] }>(
    `/api/services/${serviceId}/gbp/locations`, fetcher
  )
  const locations = locData?.data ?? []
  const [selected, setSelected] = useState<GbpLocation | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    setError('')
    const res = await fetch(`/api/services/${serviceId}/gbp/site`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gbp_location_name: selected.name,
        gbp_title:         selected.title,
        gbp_account_name:  selected.accountName,
      }),
    })
    const json = await res.json()
    if (!json.success) { setError(json.error ?? '保存に失敗しました'); setSaving(false); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">ロケーションを選択</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
            </div>
          ) : !locData?.success ? (
            <p className="text-sm text-red-600 text-center py-6">
              ロケーション取得に失敗しました。<br />先にGoogleアカウントと連携してください。
            </p>
          ) : locations.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">利用可能なロケーションがありません</p>
          ) : (
            <div className="space-y-2">
              {locations.map(loc => (
                <button
                  key={loc.name}
                  onClick={() => setSelected(loc)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition ${
                    selected?.name === loc.name
                      ? 'border-teal-400 bg-teal-50'
                      : 'border-gray-200 hover:border-teal-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-xl">🏢</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{loc.title}</p>
                    <p className="text-xs text-gray-400 truncate">{loc.name}</p>
                  </div>
                  {selected?.name === loc.name && (
                    <svg className="w-5 h-5 text-teal-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={!selected || saving}
            className="flex-1 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-50 transition"
          >
            {saving ? '保存中...' : '設定する'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- メインページ（設定） ----------
export default function GbpServicePage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [showLocationModal, setShowLocationModal] = useState(false)

  const { data: serviceData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`, fetcher
  )
  const service = serviceData?.data
  const clientId = service?.client?.id

  const { data: credData, mutate: mutateCred } = useSWR<{ success: boolean; data: GbpCredential | null }>(
    clientId ? `/api/clients/${clientId}/gbp/credential` : null, fetcher
  )
  const credential = credData?.data

  const { data: siteData, mutate: mutateSite } = useSWR<{ success: boolean; data: GbpSite | null }>(
    `/api/services/${serviceId}/gbp/site`, fetcher
  )
  const site = siteData?.data

  const handleDisconnect = async () => {
    if (!confirm('Google連携を解除しますか？')) return
    await fetch(`/api/clients/${clientId}/gbp/auth`, { method: 'DELETE' })
    mutateCred()
  }

  if (!service) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/clients" className="hover:text-teal-600">クライアント一覧</Link>
        <span>›</span>
        <Link href={`/clients/${service.client.id}`} className="hover:text-teal-600">
          {service.client.client_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-teal-600">
          {service.project.project_name}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">{service.service_name}</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-100 to-green-100 flex items-center justify-center text-xl">🏢</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GBP</h1>
          <p className="text-sm text-gray-400">{service.service_name}</p>
        </div>
      </div>

      {/* タブナビ */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/gbp/dashboard`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px"
        >
          ダッシュボード
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/gbp`}
          className="px-4 py-2.5 text-sm font-medium text-teal-600 border-b-2 border-teal-600 -mb-px"
        >
          設定
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/summary`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px"
        >
          サマリー
        </Link>
      </div>

      {/* Google OAuth 連携 */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-100 to-green-100 flex items-center justify-center text-lg">🔑</div>
          <h2 className="font-bold text-gray-900">Google アカウント連携</h2>
          <span className="text-xs text-gray-400 ml-1">（クライアント「{service.client.client_name}」単位）</span>
        </div>

        {!credential || credential.auth_status === 'pending' ? (
          <div className="flex flex-col items-center py-4 gap-3">
            <p className="text-sm text-gray-500">
              {!credential
                ? 'GBPデータを取得するには、クライアント設定でOAuth情報を登録してください'
                : 'OAuth情報は登録済みです。Googleアカウントとの連携を完了してください'}
            </p>
            <Link
              href={`/clients/${clientId}`}
              className="flex items-center gap-2 px-5 py-2.5 bg-white border-2 border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:border-teal-400 hover:text-teal-700 transition"
            >
              クライアント設定画面を開く
            </Link>
          </div>
        ) : credential.auth_status === 'error' || credential.auth_status === 'revoked' ? (
          <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-medium text-red-700">
                {credential.auth_status === 'error' ? '認証エラー：再連携が必要です' : '連携が解除されています'}
              </p>
              {credential.google_account_email && (
                <p className="text-xs text-red-500 mt-0.5">{credential.google_account_email}</p>
              )}
            </div>
            <a
              href={`/api/clients/${clientId}/gbp/auth`}
              className="px-4 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
            >
              再連携
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <div>
                <p className="text-sm font-medium text-green-800">連携済み</p>
                {credential.google_account_email && (
                  <p className="text-xs text-green-600">{credential.google_account_email}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              className="text-xs text-gray-400 hover:text-red-500 transition"
            >
              連携解除
            </button>
          </div>
        )}
      </div>

      {/* ロケーション設定 */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-100 to-green-100 flex items-center justify-center text-lg">🏢</div>
            <h2 className="font-bold text-gray-900">GBP ロケーション設定</h2>
          </div>
          {credential?.auth_status === 'active' && (
            <button
              onClick={() => setShowLocationModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-teal-700 border border-teal-300 rounded-lg hover:bg-teal-50 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {site ? '変更' : 'ロケーションを設定'}
            </button>
          )}
        </div>

        {!site ? (
          <div className="text-center py-6 text-sm text-gray-400">
            <p>ロケーションが未設定です</p>
            {credential?.auth_status === 'active' ? (
              <button
                onClick={() => setShowLocationModal(true)}
                className="mt-2 text-teal-600 hover:underline text-sm font-medium"
              >
                ロケーションを選択する
              </button>
            ) : (
              <p className="mt-1 text-xs text-gray-300">先にGoogleアカウントと連携してください</p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-4 bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
            <span className="text-2xl">🏢</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900">{site.gbp_title ?? site.gbp_location_name}</p>
              <p className="text-xs text-gray-400 truncate">{site.gbp_location_name}</p>
              {site.last_synced_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  最終同期: {new Date(site.last_synced_at).toLocaleString('ja-JP')}
                </p>
              )}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${site.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {site.is_active ? '有効' : '無効'}
            </span>
          </div>
        )}
      </div>

      {/* サマリーテンプレート */}
      <Link
        href={`/projects/${projectId}/services/${serviceId}/summary`}
        className="flex items-center justify-between bg-white rounded-2xl border border-gray-200 p-5 mt-6 hover:border-teal-200 transition group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-100 to-green-100 flex items-center justify-center text-lg">📊</div>
          <div>
            <p className="text-sm font-bold text-gray-900 group-hover:text-teal-600 transition">サマリーテンプレート</p>
            <p className="text-xs text-gray-500">テンプレートの作成・編集</p>
          </div>
        </div>
        <svg className="w-4 h-4 text-gray-400 group-hover:text-teal-600 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>

      {showLocationModal && (
        <LocationSelectModal
          serviceId={serviceId}
          onClose={() => setShowLocationModal(false)}
          onSaved={() => mutateSite()}
        />
      )}
    </div>
  )
}
