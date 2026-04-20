'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { MessagingApiSetup } from './_components/messaging-api-setup'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ---------- 型 ----------
interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
}

interface LineOamConfig {
  id: string
  service_id: string
  bot_id: string
  is_active: boolean
  updated_at: string
}

interface Rewardcard {
  id: string
  service_id: string
  rewardcard_id: string
  name: string | null
  start_date: string | null
  is_active: boolean
  created_at: string
}

// ---------- メインページ ----------
export default function LineServicePage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = svcData?.data

  return (
    <div className="w-full max-w-none min-w-0 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">💬</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">LINE 設定（統合）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <MessagingApiSetup serviceId={serviceId} />

      {/* bot_id 設定 */}
      <BotIdSection serviceId={serviceId} />

      {/* リワードカード設定 */}
      <RewardcardSection serviceId={serviceId} />

      <Link
        href={`/projects/${projectId}/services/${serviceId}/line/integrations`}
        className="flex items-center justify-between bg-white rounded-2xl border border-gray-200 p-5 mt-6 hover:border-green-200 transition group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-gray-100 flex items-center justify-center text-lg">
            🔗
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 group-hover:text-green-600 transition">
              MA 外部連携・API キー
            </p>
            <p className="text-xs text-gray-500">Outbound Webhook・外部 API キー（別画面）</p>
          </div>
        </div>
        <svg className="w-4 h-4 text-gray-400 group-hover:text-green-600 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>

      {/* サマリーテンプレート */}
      <Link
        href={`/projects/${projectId}/services/${serviceId}/summary`}
        className="flex items-center justify-between bg-white rounded-2xl border border-gray-200 p-5 mt-6 hover:border-green-200 transition group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-lg">📊</div>
          <div>
            <p className="text-sm font-bold text-gray-900 group-hover:text-green-600 transition">サマリーテンプレート</p>
            <p className="text-xs text-gray-500">テンプレートの作成・編集</p>
          </div>
        </div>
        <svg className="w-4 h-4 text-gray-400 group-hover:text-green-600 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  )
}

// ---------- bot_id セクション ----------
function BotIdSection({ serviceId }: { serviceId: string }) {
  const { data, mutate } = useSWR<{ success: boolean; data: LineOamConfig | null }>(
    `/api/services/${serviceId}/line-oam/config`,
    fetcher
  )
  const config = data?.data

  const [editing, setEditing]   = useState(false)
  const [botId, setBotId]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const startEdit = () => {
    setBotId(config?.bot_id ?? '')
    setEditing(true)
    setError('')
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!botId.trim()) { setError('bot_id を入力してください'); return }
    setSaving(true)
    setError('')
    const res = await fetch(`/api/services/${serviceId}/line-oam/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: botId.trim(), is_active: true }),
    })
    const json = await res.json()
    if (!json.success) { setError(json.error ?? '保存に失敗しました'); setSaving(false); return }
    setEditing(false)
    setSaving(false)
    mutate()
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-gray-900">公式アカウント設定</h2>
        {config && !editing && (
          <button onClick={startEdit} className="text-xs text-gray-400 hover:text-green-600 transition">
            編集
          </button>
        )}
      </div>

      {/* 未登録 */}
      {!config && !editing && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">bot_id（LINE 公式アカウントID）を登録してください</p>
          <button
            onClick={startEdit}
            className="px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition"
          >
            bot_id を登録
          </button>
        </div>
      )}

      {/* 登録済み */}
      {config && !editing && (
        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">bot_id</p>
            <p className="text-sm font-mono font-medium text-gray-800">{config.bot_id}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            config.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {config.is_active ? '有効' : '無効'}
          </span>
        </div>
      )}

      {/* フォーム */}
      {editing && (
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              bot_id <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={botId}
              onChange={e => setBotId(e.target.value)}
              placeholder="例: 123456789"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setEditing(false); setError('') }}
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

// ---------- リワードカードセクション ----------
function RewardcardSection({ serviceId }: { serviceId: string }) {
  const { data, mutate } = useSWR<{ success: boolean; data: Rewardcard[] }>(
    `/api/services/${serviceId}/line-oam/rewardcards`,
    fetcher
  )
  const cards = data?.data ?? []

  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-bold text-gray-900">
          リワードカード
          <span className="ml-2 text-sm font-normal text-gray-400">{cards.length}件</span>
        </h2>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            追加
          </button>
        )}
      </div>

      {/* 追加フォーム */}
      {showAdd && (
        <div className="px-6 py-4 border-b border-gray-100 bg-green-50">
          <RewardcardForm
            serviceId={serviceId}
            onClose={() => setShowAdd(false)}
            onSaved={() => { setShowAdd(false); mutate() }}
          />
        </div>
      )}

      {/* カード一覧 */}
      {cards.length === 0 && !showAdd ? (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400">
          <p className="text-sm">リワードカードが登録されていません</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-2 text-green-600 text-sm font-medium hover:underline"
          >
            最初のカードを追加する
          </button>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {cards.map(card => (
            <div key={card.id} className="px-6 py-4">
              {editingId === card.id ? (
                <RewardcardForm
                  serviceId={serviceId}
                  existing={card}
                  onClose={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); mutate() }}
                />
              ) : (
                <RewardcardRow
                  card={card}
                  onEdit={() => setEditingId(card.id)}
                  onDelete={async () => {
                    if (!confirm(`「${card.name ?? card.rewardcard_id}」を削除しますか？`)) return
                    await fetch(`/api/services/${serviceId}/line-oam/rewardcards?id=${card.id}`, {
                      method: 'DELETE',
                    })
                    mutate()
                  }}
                  onToggleActive={async () => {
                    await fetch(`/api/services/${serviceId}/line-oam/rewardcards?id=${card.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ is_active: !card.is_active }),
                    })
                    mutate()
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RewardcardRow({
  card,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  card: Rewardcard
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-800 truncate">
            {card.name ?? '（名前なし）'}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
            card.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
          }`}>
            {card.is_active ? '有効' : '無効'}
          </span>
        </div>
        <p className="text-xs text-gray-400 font-mono">rewardcard_id: {card.rewardcard_id}</p>
        {card.start_date && (
          <p className="text-xs text-gray-400 mt-0.5">
            開始日: {card.start_date}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onToggleActive}
          className="text-xs text-gray-400 hover:text-green-600 transition"
        >
          {card.is_active ? '無効化' : '有効化'}
        </button>
        <button onClick={onEdit} className="text-xs text-gray-400 hover:text-blue-600 transition">
          編集
        </button>
        <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-500 transition">
          削除
        </button>
      </div>
    </div>
  )
}

function RewardcardForm({
  serviceId,
  existing,
  onClose,
  onSaved,
}: {
  serviceId: string
  existing?: Rewardcard
  onClose: () => void
  onSaved: () => void
}) {
  const [rewardcardId, setRewardcardId] = useState(existing?.rewardcard_id ?? '')
  const [name, setName]                 = useState(existing?.name ?? '')
  const [startDate, setStartDate]       = useState(existing?.start_date ?? '')
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rewardcardId.trim()) { setError('rewardcard_id を入力してください'); return }
    setSaving(true)
    setError('')

    let res: Response
    if (existing) {
      res = await fetch(`/api/services/${serviceId}/line-oam/rewardcards?id=${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:       name.trim() || null,
          start_date: startDate || null,
        }),
      })
    } else {
      res = await fetch(`/api/services/${serviceId}/line-oam/rewardcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewardcard_id: rewardcardId.trim(),
          name:          name.trim() || null,
          start_date:    startDate || null,
        }),
      })
    }

    const json = await res.json()
    if (!json.success) { setError(json.error ?? '保存に失敗しました'); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs font-semibold text-gray-700">
        {existing ? 'リワードカードを編集' : 'リワードカードを追加'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            rewardcard_id <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={rewardcardId}
            onChange={e => setRewardcardId(e.target.value)}
            disabled={!!existing}
            placeholder="例: abc123"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">名前（任意）</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例: スタンプカード2024"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">開始日（任意）</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
          キャンセル
        </button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 transition">
          {saving ? '保存中...' : existing ? '更新' : '追加'}
        </button>
      </div>
    </form>
  )
}
