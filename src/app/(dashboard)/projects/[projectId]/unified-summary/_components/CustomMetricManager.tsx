'use client'

/**
 * CustomMetricManager
 *
 * カスタム指標（計算式）の CRUD UI。
 * KPIツリーエディタ内でモーダルとして表示する。
 *
 * 数式構文: {{serviceId::metricRef}} で他指標を参照
 * 例: {{uuid::ig_reach}} / {{uuid::ig_views}} * 100
 */

import { useState } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 型 ──────────────────────────────────────────────────────────────────────

interface CustomMetric {
  id:          string
  name:        string
  formula:     string
  unit:        string | null
  description: string | null
  created_at:  string
}

interface MetricOption {
  colKey:  string
  label:   string
  service: string
}

// ── フォーミュラ構文ハイライト ─────────────────────────────────────────────────

function FormulaPreview({ formula, metricOptions }: { formula: string; metricOptions: MetricOption[] }) {
  if (!formula.trim()) return null

  // {{colKey}} をラベルに変換して表示
  const parts: { text: string; isRef: boolean; label?: string }[] = []
  let last = 0
  const matches = Array.from(formula.matchAll(/\{\{([^}]+)\}\}/g))
  for (const m of matches) {
    if (m.index! > last) parts.push({ text: formula.slice(last, m.index), isRef: false })
    const colKey = m[1].trim()
    const opt    = metricOptions.find(o => o.colKey === colKey)
    parts.push({ text: m[0], isRef: true, label: opt ? `${opt.service}:${opt.label}` : colKey })
    last = m.index! + m[0].length
  }
  if (last < formula.length) parts.push({ text: formula.slice(last), isRef: false })

  return (
    <div className="mt-1 text-[11px] font-mono bg-gray-50 rounded-lg px-3 py-2 leading-relaxed break-all">
      {parts.map((p, i) =>
        p.isRef ? (
          <span key={i} className="inline-flex items-center bg-indigo-100 text-indigo-700 rounded px-1 mx-0.5 font-semibold">
            {p.label ?? p.text}
          </span>
        ) : (
          <span key={i} className="text-gray-700">{p.text}</span>
        )
      )}
    </div>
  )
}

// ── 数式入力フォーム ──────────────────────────────────────────────────────────

function MetricForm({
  initial, metricOptions, onSave, onCancel,
}: {
  initial?:      CustomMetric
  metricOptions: MetricOption[]
  onSave:        (data: { name: string; formula: string; unit: string; description: string }) => Promise<void>
  onCancel:      () => void
}) {
  const [name,        setName]        = useState(initial?.name        ?? '')
  const [formula,     setFormula]     = useState(initial?.formula     ?? '')
  const [unit,        setUnit]        = useState(initial?.unit        ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [showPicker,  setShowPicker]  = useState(false)
  const [search,      setSearch]      = useState('')

  const insertRef = (colKey: string) => {
    setFormula(prev => prev + `{{${colKey}}}`)
    setShowPicker(false)
    setSearch('')
  }

  const filteredOptions = search.trim()
    ? metricOptions.filter(m =>
        m.label.toLowerCase().includes(search.toLowerCase()) ||
        m.service.toLowerCase().includes(search.toLowerCase()) ||
        m.colKey.toLowerCase().includes(search.toLowerCase())
      )
    : metricOptions

  const handleSave = async () => {
    if (!name.trim() || !formula.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), formula: formula.trim(), unit: unit.trim(), description: description.trim() })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* 名前 */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">指標名 <span className="text-red-400">*</span></label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="例: エンゲージメント率、ROI"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-400" />
      </div>

      {/* 数式 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-600">計算式 <span className="text-red-400">*</span></label>
          <button onClick={() => setShowPicker(v => !v)}
            className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition">
            📌 指標を挿入
          </button>
        </div>

        {showPicker && (
          <div className="mb-2 border border-indigo-100 rounded-lg bg-white shadow-sm overflow-hidden">
            <div className="px-2 py-1.5 border-b border-gray-100">
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="指標を検索..."
                autoFocus
                className="w-full text-xs border-none outline-none bg-transparent" />
            </div>
            <div className="max-h-40 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">見つかりません</p>
              ) : (
                filteredOptions.slice(0, 30).map(m => (
                  <button key={m.colKey} onClick={() => insertRef(m.colKey)}
                    className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-indigo-50 transition">
                    <span className="text-gray-400 flex-shrink-0">{m.service}</span>
                    <span className="font-medium text-gray-700 truncate">{m.label}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <textarea
          value={formula}
          onChange={e => setFormula(e.target.value)}
          placeholder={'例: {{uuid::ig_likes}} / {{uuid::ig_reach}} * 100\n（{{...}} で指標を参照、四則演算が使えます）'}
          className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
          rows={3}
        />

        {/* プレビュー */}
        <FormulaPreview formula={formula} metricOptions={metricOptions} />

        <p className="text-[10px] text-gray-400 mt-1">
          構文: <code className="bg-gray-100 px-1 rounded">{"{{serviceId::metricRef}}"}</code> で指標を参照。
          四則演算（+, -, *, /）と括弧が使えます。
        </p>
      </div>

      {/* 単位・説明 */}
      <div className="flex gap-3">
        <div className="w-28">
          <label className="block text-xs text-gray-500 mb-1">単位（任意）</label>
          <input value={unit} onChange={e => setUnit(e.target.value)}
            placeholder="例: %, 件, 円"
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-400" />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">説明（任意）</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="例: エンゲージメント率 = (いいね+コメント) ÷ リーチ"
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-400" />
        </div>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave} disabled={saving || !name.trim() || !formula.trim()}
          className="text-sm px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition disabled:opacity-50 font-medium">
          {saving ? '保存中...' : initial ? '更新' : '作成'}
        </button>
        <button onClick={onCancel}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
          キャンセル
        </button>
      </div>
    </div>
  )
}

// ── メインエクスポート ─────────────────────────────────────────────────────────

export function CustomMetricManager({
  projectId,
  metricOptions,
  onClose,
  onMetricsChange,
}: {
  projectId:       string
  metricOptions:   MetricOption[]
  onClose:         () => void
  onMetricsChange: () => void
}) {
  const { data: resp, mutate } = useSWR<{ success: boolean; data: CustomMetric[] }>(
    `/api/projects/${projectId}/custom-metrics`,
    fetcher,
  )
  const metrics = resp?.data ?? []

  const [mode,    setMode]    = useState<'list' | 'create' | 'edit'>('list')
  const [editing, setEditing] = useState<CustomMetric | null>(null)

  const createMetric = async (data: { name: string; formula: string; unit: string; description: string }) => {
    const res  = await fetch(`/api/projects/${projectId}/custom-metrics`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? 'エラーが発生しました')
    mutate()
    onMetricsChange()
    setMode('list')
  }

  const updateMetric = async (data: { name: string; formula: string; unit: string; description: string }) => {
    if (!editing) return
    const res  = await fetch(`/api/projects/${projectId}/custom-metrics/${editing.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? 'エラーが発生しました')
    mutate()
    onMetricsChange()
    setMode('list')
    setEditing(null)
  }

  const deleteMetric = async (id: string) => {
    if (!confirm('このカスタム指標を削除しますか？KPIツリーノードで使用中の場合は指標が未設定になります。')) return
    await fetch(`/api/projects/${projectId}/custom-metrics/${id}`, { method: 'DELETE' })
    mutate()
    onMetricsChange()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-2xl pointer-events-auto flex flex-col max-h-[85vh]">
          {/* ヘッダー */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="text-base font-bold text-gray-800">🧮 カスタム指標管理</h2>
              <p className="text-xs text-gray-400 mt-0.5">既存の指標を組み合わせた計算式指標を作成・管理できます</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">✕</button>
          </div>

          {/* ボディ */}
          <div className="flex-1 overflow-y-auto p-6">
            {mode === 'create' ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-4">＋ 新規カスタム指標</h3>
                <MetricForm
                  metricOptions={metricOptions}
                  onSave={createMetric}
                  onCancel={() => setMode('list')}
                />
              </div>
            ) : mode === 'edit' && editing ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-4">✏️ 編集: {editing.name}</h3>
                <MetricForm
                  initial={editing}
                  metricOptions={metricOptions}
                  onSave={updateMetric}
                  onCancel={() => { setMode('list'); setEditing(null) }}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">{metrics.length} 件のカスタム指標</p>
                  <button onClick={() => setMode('create')}
                    className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition font-medium">
                    ＋ 新規作成
                  </button>
                </div>

                {metrics.length === 0 ? (
                  <div className="border border-dashed border-gray-200 rounded-xl p-10 text-center">
                    <p className="text-sm text-gray-400 mb-1">カスタム指標がまだありません</p>
                    <p className="text-xs text-gray-400">「＋ 新規作成」で計算式を定義してください</p>
                    <div className="mt-4 text-[11px] text-gray-400 bg-gray-50 rounded-lg px-4 py-3 text-left space-y-1 max-w-sm mx-auto">
                      <p className="font-semibold text-gray-500">使用例:</p>
                      <p>• エンゲージメント率 = (いいね + コメント) ÷ リーチ</p>
                      <p>• 広告 ROI = 売上 ÷ 広告費 × 100</p>
                      <p>• 問い合わせ転換率 = 問い合わせ数 ÷ セッション数</p>
                    </div>
                  </div>
                ) : (
                  metrics.map(m => (
                    <div key={m.id} className="border border-gray-200 rounded-xl p-4 hover:border-indigo-200 transition group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-800">🧮 {m.name}</span>
                            {m.unit && (
                              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{m.unit}</span>
                            )}
                          </div>
                          {m.description && (
                            <p className="text-xs text-gray-500 mt-0.5">{m.description}</p>
                          )}
                          <div className="mt-2">
                            <FormulaPreview formula={m.formula} metricOptions={metricOptions} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={() => { setEditing(m); setMode('edit') }}
                            className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 transition">
                            編集
                          </button>
                          <button
                            onClick={() => deleteMetric(m.id)}
                            className="text-xs px-2.5 py-1 rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-500 transition">
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* フッター */}
          <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
            <p className="text-[10px] text-gray-400">
              カスタム指標は <code className="bg-white border border-gray-200 rounded px-1">{"{{serviceId::metricRef}}"}</code> 形式で他の指標を参照できます。
              KPIツリーの指標プルダウンで「カスタム」セクションから選択できます。
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
