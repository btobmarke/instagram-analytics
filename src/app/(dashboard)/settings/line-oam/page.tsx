'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'

interface UrlTemplate {
  id:           string
  csv_type:     string
  url_template: string
  description:  string | null
}

const CSV_TYPE_LABELS: Record<string, string> = {
  base_url:        'ベースURL',
  contacts:        'フレンド数',
  friends_attr:    'フレンド属性',
  shopcard_status: 'ショップカード・ステータス',
  shopcard_point:  'ショップカード・ポイント分布',
  rewardcard_txns: 'リワードカード・取引履歴',
}

const CSV_TYPE_ORDER = ['base_url', 'contacts', 'friends_attr', 'shopcard_status', 'shopcard_point', 'rewardcard_txns']

export default function LineOamSettingsPage() {
  const [templates, setTemplates] = useState<UrlTemplate[]>([])
  const [editing, setEditing]     = useState<Record<string, string>>({})
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)

  useEffect(() => {
    fetch('/api/settings/line-oam/url-templates')
      .then(r => r.json())
      .then(j => {
        const data: UrlTemplate[] = j.data ?? []
        setTemplates(data)
        setEditing(Object.fromEntries(data.map(t => [t.csv_type, t.url_template])))
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    const payload = templates.map(t => ({
      csv_type:     t.csv_type,
      url_template: editing[t.csv_type] ?? t.url_template,
      description:  t.description,
    }))
    const res = await fetch('/api/settings/line-oam/url-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) setSaved(true)
    setSaving(false)
  }

  const sorted = CSV_TYPE_ORDER
    .map(type => templates.find(t => t.csv_type === type))
    .filter((t): t is UrlTemplate => !!t)

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">LINE OAM 設定</h1>
        <p className="text-sm text-gray-500 mt-1">
          LINE OAM データ取得に使用する URL テンプレートを管理します。
          プレースホルダ: <code className="bg-gray-100 px-1 rounded text-xs">{'{'+'base_url'+'}'}</code>、
          <code className="bg-gray-100 px-1 rounded text-xs">{'{'+'bot_id'+'}'}</code>、
          <code className="bg-gray-100 px-1 rounded text-xs">{'{'+'rewardcard_id'+'}'}</code> 等
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">URL テンプレート</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {sorted.map(t => (
              <div key={t.csv_type} className="px-6 py-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-800">
                    {CSV_TYPE_LABELS[t.csv_type] ?? t.csv_type}
                  </span>
                  <span className="text-xs text-gray-400 font-mono bg-gray-50 px-1.5 py-0.5 rounded">
                    {t.csv_type}
                  </span>
                </div>
                {t.description && (
                  <p className="text-xs text-gray-400 mb-2">{t.description}</p>
                )}
                <textarea
                  rows={2}
                  value={editing[t.csv_type] ?? ''}
                  onChange={e => setEditing(prev => ({ ...prev, [t.csv_type]: e.target.value }))}
                  className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
                />
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-xl
              hover:bg-green-700 transition disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">✓ 保存しました</span>
          )}
        </div>
      </div>
    </div>
  )
}
