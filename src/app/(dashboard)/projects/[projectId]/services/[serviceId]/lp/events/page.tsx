'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const INTENT_TYPE_OPTIONS = [
  { value: 'CTA', label: 'CTA', color: 'bg-orange-100 text-orange-700' },
  { value: 'SCROLL', label: 'スクロール', color: 'bg-blue-100 text-blue-700' },
  { value: 'FORM', label: 'フォーム', color: 'bg-green-100 text-green-700' },
  { value: 'CLICK', label: 'クリック', color: 'bg-purple-100 text-purple-700' },
  { value: 'VIDEO', label: '動画', color: 'bg-red-100 text-red-700' },
  { value: 'OTHER', label: 'その他', color: 'bg-gray-100 text-gray-700' },
]

interface EventRuleItem {
  eventRuleId: string
  eventId: string
  eventName: string
  intentType: string
  intentScore: number
  isActive: boolean
  note: string | null
  fireCount: number
  createdAt: string
}

function IntentTypeBadge({ intentType }: { intentType: string }) {
  const opt = INTENT_TYPE_OPTIONS.find(o => o.value === intentType)
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${opt?.color ?? 'bg-gray-100 text-gray-700'}`}>
      {opt?.label ?? intentType}
    </span>
  )
}

export default function LpEventsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingRule, setEditingRule] = useState<EventRuleItem | null>(null)

  const { data, isLoading, mutate } = useSWR<{
    success: boolean
    data: EventRuleItem[]
    meta: { totalCount: number }
  }>(`/api/services/${serviceId}/lp/events?page_size=100`, fetcher)

  const rules = data?.data ?? []
  const activeRules = rules.filter(r => r.isActive)
  const inactiveRules = rules.filter(r => !r.isActive)

  const handleToggle = async (rule: EventRuleItem) => {
    await fetch(`/api/services/${serviceId}/lp/events/${rule.eventRuleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !rule.isActive }),
    })
    mutate()
  }

  return (
    <div className="p-6 w-full max-w-none min-w-0">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href={`/projects/${projectId}/services/${serviceId}/lp`} className="hover:text-purple-600">LP</Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">イベント管理</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">⚡ イベント管理</h1>
          <p className="text-sm text-gray-400 mt-1">インテントスコアを算出するイベントルールを管理します</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          イベント追加
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400">
          <span className="text-4xl mb-3">⚡</span>
          <p className="text-sm">イベントルールがありません</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-3 text-purple-600 text-sm font-medium hover:underline"
          >
            最初のイベントを追加する
          </button>
        </div>
      ) : (
        <>
          {/* Active Rules */}
          {activeRules.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                有効 ({activeRules.length}件)
              </h2>
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500">イベント</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500">種別</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500">スコア</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500">発火数</th>
                      <th className="px-5 py-3.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {activeRules.map(rule => (
                      <tr key={rule.eventRuleId} className="hover:bg-purple-50/20 transition-colors">
                        <td className="px-5 py-4">
                          <p className="font-medium text-gray-900">{rule.eventName}</p>
                          <p className="text-xs font-mono text-gray-400 mt-0.5">{rule.eventId}</p>
                        </td>
                        <td className="px-5 py-4">
                          <IntentTypeBadge intentType={rule.intentType} />
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-bold text-purple-700">+{rule.intentScore}</span>
                        </td>
                        <td className="px-5 py-4 text-gray-600">
                          {rule.fireCount.toLocaleString()}回
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditingRule(rule)}
                              className="text-xs text-gray-400 hover:text-purple-600 px-2 py-1 rounded hover:bg-purple-50 transition-colors"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => handleToggle(rule)}
                              className="text-xs text-gray-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                            >
                              無効化
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Inactive Rules */}
          {inactiveRules.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                無効 ({inactiveRules.length}件)
              </h2>
              <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {inactiveRules.map(rule => (
                      <tr key={rule.eventRuleId} className="opacity-60">
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-700">{rule.eventName}</p>
                          <p className="text-xs font-mono text-gray-400">{rule.eventId}</p>
                        </td>
                        <td className="px-5 py-3">
                          <IntentTypeBadge intentType={rule.intentType} />
                        </td>
                        <td className="px-5 py-3 text-gray-500">+{rule.intentScore}</td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => handleToggle(rule)}
                            className="text-xs text-purple-600 hover:underline"
                          >
                            有効化
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <EventRuleModal
          serviceId={serviceId}
          onClose={() => setShowCreateModal(false)}
          onSaved={() => { setShowCreateModal(false); mutate() }}
        />
      )}

      {/* Edit Modal */}
      {editingRule && (
        <EventRuleModal
          serviceId={serviceId}
          editRule={editingRule}
          onClose={() => setEditingRule(null)}
          onSaved={() => { setEditingRule(null); mutate() }}
        />
      )}
    </div>
  )
}

function EventRuleModal({
  serviceId,
  editRule,
  onClose,
  onSaved,
}: {
  serviceId: string
  editRule?: EventRuleItem
  onClose: () => void
  onSaved: () => void
}) {
  const [eventId, setEventId] = useState(editRule?.eventId ?? '')
  const [eventName, setEventName] = useState(editRule?.eventName ?? '')
  const [intentType, setIntentType] = useState(editRule?.intentType ?? 'OTHER')
  const [intentScore, setIntentScore] = useState(editRule?.intentScore ?? 0)
  const [note, setNote] = useState(editRule?.note ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isEdit = !!editRule

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!eventName.trim()) { setError('イベント名を入力してください'); return }
    if (!isEdit && !eventId.trim()) { setError('イベントIDを入力してください'); return }

    setLoading(true)
    setError('')
    try {
      let res: Response
      if (isEdit) {
        res = await fetch(`/api/services/${serviceId}/lp/events/${editRule.eventRuleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_name: eventName, intent_type: intentType, intent_score: intentScore, note: note || null }),
        })
      } else {
        res = await fetch(`/api/services/${serviceId}/lp/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: eventId, event_name: eventName, intent_type: intentType, intent_score: intentScore, note: note || undefined }),
        })
      }
      const json = await res.json()
      if (!json.success) { setError(json.error?.message ?? '保存に失敗しました'); return }
      onSaved()
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? 'イベントルール編集' : '新規イベント追加'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                イベントID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={eventId}
                onChange={e => setEventId(e.target.value)}
                placeholder="例: cta_click_main"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 font-mono"
                maxLength={255}
              />
              <p className="text-xs text-gray-400 mt-1">JSコード内で使用するイベント識別子</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              イベント名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={eventName}
              onChange={e => setEventName(e.target.value)}
              placeholder="例: メインCTAクリック"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
              maxLength={255}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">インテント種別</label>
              <select
                value={intentType}
                onChange={e => setIntentType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
              >
                {INTENT_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">インテントスコア</label>
              <input
                type="number"
                value={intentScore}
                onChange={e => setIntentScore(Number(e.target.value))}
                min={0}
                max={9999}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="イベントの説明など"
              rows={2}
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
              {loading ? '保存中...' : isEdit ? '更新する' : '追加する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
