'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  service_type: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
}

interface GoogleAdsConfig {
  id: string
  service_id: string
  customer_id: string
  account_name: string | null
  currency_code: string | null
  time_zone: string | null
  collect_keywords: boolean
  backfill_days: number
  is_active: boolean
  last_synced_at: string | null
  updated_at: string
}

export default function GoogleAdsSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(`/api/services/${serviceId}`, fetcher)
  const service = svcData?.data

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/clients" className="hover:text-blue-600">
          クライアント一覧
        </Link>
        <span>›</span>
        <Link href={`/clients/${service?.client.id}`} className="hover:text-blue-600">
          {service?.client.client_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-blue-600">
          {service?.project.project_name}
        </Link>
        <span>›</span>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/integrations`}
          className="hover:text-blue-600"
        >
          {service?.service_name ?? 'Google 広告'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">設定</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-sky-100 flex items-center justify-center text-xl">
          📣
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Google 広告</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/analytics`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          ダッシュボード
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/summary`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          サマリー
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/ai`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          AI分析
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/settings`}
          className="px-4 py-2.5 text-sm font-medium text-blue-600 border-b-2 border-blue-600 -mb-px"
        >
          設定
        </Link>
      </div>

      <GoogleAdsConfigSection serviceId={serviceId} />
    </div>
  )
}

function GoogleAdsConfigSection({ serviceId }: { serviceId: string }) {
  const { data, mutate } = useSWR<{ success: boolean; data: GoogleAdsConfig | null }>(
    `/api/services/${serviceId}/google-ads/config`,
    fetcher
  )
  const config = data?.data

  const [editing, setEditing] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [accountName, setAccountName] = useState('')
  const [currencyCode, setCurrencyCode] = useState('JPY')
  const [timeZone, setTimeZone] = useState('Asia/Tokyo')
  const [collectKeywords, setCollectKeywords] = useState(false)
  const [backfillDays, setBackfillDays] = useState(30)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

  const runSync = async () => {
    setSyncing(true)
    setError('')
    try {
      const res = await fetch(`/api/services/${serviceId}/google-ads/sync`, { method: 'POST' })
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        setError(json.error ?? `同期に失敗しました (${res.status})`)
        return
      }
      await mutate()
    } finally {
      setSyncing(false)
    }
  }

  const startEdit = () => {
    setCustomerId(config?.customer_id ?? '')
    setAccountName(config?.account_name ?? '')
    setCurrencyCode(config?.currency_code ?? 'JPY')
    setTimeZone(config?.time_zone ?? 'Asia/Tokyo')
    setCollectKeywords(Boolean(config?.collect_keywords ?? false))
    setBackfillDays(Number(config?.backfill_days ?? 30))
    setEditing(true)
    setError('')
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId.trim()) {
      setError('customer_id を入力してください')
      return
    }
    setSaving(true)
    setError('')
    const res = await fetch(`/api/services/${serviceId}/google-ads/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customerId.trim(),
        account_name: accountName.trim() || null,
        currency_code: currencyCode.trim() || 'JPY',
        time_zone: timeZone.trim() || 'Asia/Tokyo',
        collect_keywords: collectKeywords,
        backfill_days: backfillDays,
        is_active: true,
      }),
    })
    const json = await res.json()
    if (!json.success) {
      setError(json.error ?? '保存に失敗しました')
      setSaving(false)
      return
    }
    setEditing(false)
    setSaving(false)
    mutate()
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-100 to-sky-100 flex items-center justify-center text-lg">
            ⚙️
          </div>
          <h2 className="font-bold text-gray-900">広告アカウント設定</h2>
        </div>
        {config && !editing && (
          <button onClick={startEdit} className="text-xs text-gray-400 hover:text-blue-600 transition">
            編集
          </button>
        )}
      </div>

      {!config && !editing && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">customer_id（広告アカウントID）を登録してください</p>
          <button
            onClick={startEdit}
            className="px-4 py-2 text-sm font-medium text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-50 transition"
          >
            設定を登録
          </button>
        </div>
      )}

      {config && !editing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">customer_id</p>
              <p className="text-sm font-mono font-medium text-gray-800">{config.customer_id}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              config.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {config.is_active ? '有効' : '無効'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs text-gray-400">
              最終同期: {config.last_synced_at ? new Date(config.last_synced_at).toLocaleString('ja-JP') : '—'}
            </div>
            {config.is_active && (
              <button
                type="button"
                onClick={runSync}
                disabled={syncing}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition"
              >
                {syncing ? '同期中…' : 'データを同期'}
              </button>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
            <p className="font-semibold mb-1">キーワード収集について</p>
            <p className="text-xs text-amber-700">
              「キーワード収集」をONにするとバッチの取得量が増え、処理時間が長くなる可能性があります（利用者増加時はバッチ分離やスケールを検討してください）。
            </p>
          </div>
        </div>
      )}

      {editing && (
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              customer_id（広告アカウントID）<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="1234567890（ハイフンなし10桁）"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">アカウント名（任意）</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="例: 本番アカウント"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">通貨</label>
              <input
                type="text"
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value)}
                placeholder="JPY"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">タイムゾーン</label>
              <input
                type="text"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                placeholder="Asia/Tokyo"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <input
              id="collectKeywords"
              type="checkbox"
              checked={collectKeywords}
              onChange={(e) => setCollectKeywords(e.target.checked)}
              className="mt-1"
            />
            <label htmlFor="collectKeywords" className="text-sm text-gray-700">
              キーワード収集を有効にする
              <p className="text-xs text-gray-400 mt-0.5">
                ONにすると取得量が増え、バッチ時間が伸びる可能性があります
              </p>
            </label>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">初回のみ: 昨日までを終端に遡る日数（1〜90）</label>
            <p className="text-xs text-gray-400 mb-1">
              通常の同期はアカウントタイムゾーンの「昨日」まで（欠損があればその分まとめて取得）。この値は{' '}
              <strong className="text-gray-500">last_synced が空の初回</strong>の範囲にだけ使われます。
            </p>
            <input
              type="number"
              value={backfillDays}
              onChange={(e) => setBackfillDays(Number(e.target.value))}
              min={1}
              max={90}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setEditing(false); setError('') }}
              className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

