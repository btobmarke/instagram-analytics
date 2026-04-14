'use client'

/**
 * ValidationPeriodsPanel
 *
 * KPI ツリーの検証期間（Pattern A）を管理するコンポーネント。
 * 過去の期間は即時 MAPE 評価、未来の期間はバッチ評価待ち表示。
 */

import { useState } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 型 ──────────────────────────────────────────────────────────────────────

interface PresetMapeResult {
  presetId:   string
  presetName: string
  targetRef:  string
  mape:       number | null
  mae:        number | null
  n:          number
  error?:     string
}

interface ValidationPeriodResults {
  presetResults: PresetMapeResult[]
  overallMape:   number | null
}

interface ValidationPeriod {
  id:           string
  name:         string
  start_date:   string
  end_date:     string
  time_unit:    string
  status:       'pending' | 'evaluating' | 'completed' | 'failed'
  results:      ValidationPeriodResults | null
  error_message: string | null
  evaluated_at: string | null
  created_at:   string
}

// ── MAPE カラー ───────────────────────────────────────────────────────────────

function mapeColor(mape: number): string {
  if (mape <= 10) return 'text-green-700 bg-green-50 border-green-100'
  if (mape <= 20) return 'text-blue-700 bg-blue-50 border-blue-100'
  if (mape <= 30) return 'text-yellow-700 bg-yellow-50 border-yellow-100'
  return 'text-red-700 bg-red-50 border-red-100'
}

function mapeLabel(mape: number): string {
  if (mape <= 10) return '高精度'
  if (mape <= 20) return '良好'
  if (mape <= 30) return '参考値'
  return '要改善'
}

function statusBadge(status: ValidationPeriod['status']) {
  switch (status) {
    case 'pending':    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">⏳ 評価待ち</span>
    case 'evaluating': return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 animate-pulse">🔄 評価中</span>
    case 'completed':  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">✓ 完了</span>
    case 'failed':     return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-500">✗ エラー</span>
  }
}

// ── 検証期間カード ────────────────────────────────────────────────────────────

function PeriodCard({
  period, projectId, treeId, onDelete, onEvaluate,
}: {
  period:     ValidationPeriod
  projectId:  string
  treeId:     string
  onDelete:   (id: string) => void
  onEvaluate: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(period.status === 'completed')

  const today    = new Date().toISOString().slice(0, 10)
  const isPast   = period.end_date < today
  const canEval  = isPast && (period.status === 'pending' || period.status === 'failed')
  const results  = period.results

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-800">{period.name}</span>
            {statusBadge(period.status)}
            {results?.overallMape != null && (
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${mapeColor(results.overallMape)}`}>
                平均 MAPE: {results.overallMape.toFixed(1)}% ({mapeLabel(results.overallMape)})
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {period.start_date} 〜 {period.end_date}
            <span className="ml-1 text-gray-400">（{period.time_unit === 'day' ? '日次' : period.time_unit === 'week' ? '週次' : '月次'}）</span>
            {period.evaluated_at && (
              <span className="ml-2 text-green-600">評価: {period.evaluated_at.slice(0, 10)}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {canEval && (
            <button onClick={() => onEvaluate(period.id)}
              className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition">
              🔄 評価実行
            </button>
          )}
          {results && (
            <button onClick={() => setExpanded(v => !v)}
              className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition">
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <button onClick={() => onDelete(period.id)}
            className="text-xs px-2 py-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
            ✕
          </button>
        </div>
      </div>

      {period.error_message && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600">
          {period.error_message}
        </div>
      )}

      {results && expanded && (
        <div className="px-4 py-4">
          <div className="space-y-2">
            {results.presetResults.map(r => (
              <div key={r.presetId} className="flex items-center gap-3 text-xs">
                <span className="flex-1 text-gray-600 truncate" title={r.presetName}>{r.presetName}</span>
                {r.mape != null ? (
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${mapeColor(r.mape)}`}>
                    MAPE: {r.mape.toFixed(1)}%
                  </span>
                ) : (
                  <span className="flex-shrink-0 text-gray-400">{r.error ?? 'N/A'}</span>
                )}
                {r.mae != null && <span className="flex-shrink-0 text-gray-400">MAE: {r.mae.toFixed(2)}</span>}
                <span className="flex-shrink-0 text-gray-400">n={r.n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── メインエクスポート ─────────────────────────────────────────────────────────

export function ValidationPeriodsPanel({
  projectId,
  treeId,
}: {
  projectId: string
  treeId:    string | null
}) {
  const { data: resp, mutate } = useSWR<{ success: boolean; data: ValidationPeriod[] }>(
    treeId ? `/api/projects/${projectId}/kpi-trees/${treeId}/validation-periods` : null,
    fetcher,
  )
  const periods = resp?.data ?? []

  const [showForm,   setShowForm]   = useState(false)
  const [name,       setName]       = useState('')
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')
  const [timeUnit,   setTimeUnit]   = useState<'day' | 'week' | 'month'>('day')
  const [saving,     setSaving]     = useState(false)
  const [saveMsg,    setSaveMsg]    = useState<string | null>(null)

  if (!treeId) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
        <p className="text-sm text-gray-400">KPI ツリーを選択してください</p>
      </div>
    )
  }

  const createPeriod = async () => {
    if (!name.trim() || !startDate || !endDate) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/kpi-trees/${treeId}/validation-periods`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name: name.trim(), startDate, endDate, timeUnit }),
        },
      )
      const json = await res.json()
      if (json.success) {
        const evaluated = json.data.evaluated
        setSaveMsg(evaluated ? '✅ 登録・MAPE評価が完了しました' : '✅ 登録しました（バッチ評価待ち）')
        setName(''); setStartDate(''); setEndDate('')
        setShowForm(false)
        mutate()
      } else {
        setSaveMsg(`エラー: ${json.error}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const deletePeriod = async (id: string) => {
    if (!confirm('この検証期間を削除しますか？')) return
    await fetch(`/api/projects/${projectId}/kpi-trees/${treeId}/validation-periods/${id}`, { method: 'DELETE' })
    mutate()
  }

  const evaluatePeriod = async (id: string) => {
    await fetch(
      `/api/projects/${projectId}/kpi-trees/${treeId}/validation-periods/${id}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'evaluate' }),
      },
    )
    mutate()
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー + 登録ボタン */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">🗓 検証期間（Pattern A: MAPE 評価）</h3>
          <p className="text-xs text-gray-400 mt-0.5">過去の期間を登録すると自動で MAPE を計算します。未来の期間はバッチ評価待ちになります。</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition">
          ＋ 検証期間を追加
        </button>
      </div>

      {/* 登録フォーム */}
      {showForm && (
        <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-3">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="検証期間名（例: 2024年Q1、春季キャンペーン）"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-gray-500 mb-1 block">開始日</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-gray-500 mb-1 block">終了日</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="text-xs text-gray-500 mb-1 block">集計粒度</label>
              <select value={timeUnit} onChange={e => setTimeUnit(e.target.value as 'day' | 'week' | 'month')}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-blue-400">
                <option value="day">日次</option>
                <option value="week">週次</option>
                <option value="month">月次</option>
              </select>
            </div>
          </div>
          <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700">
            💡 終了日が過去の場合は登録と同時に MAPE を評価します。未来の場合はバッチ処理で評価されます。
          </div>
          <div className="flex gap-2">
            <button onClick={createPeriod} disabled={saving || !name.trim() || !startDate || !endDate}
              className="text-sm px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 font-medium">
              {saving ? '登録中...' : '登録'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              キャンセル
            </button>
          </div>
          {saveMsg && <p className="text-xs text-blue-700">{saveMsg}</p>}
        </div>
      )}

      {/* 検証期間リスト */}
      {periods.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-400">検証期間がまだありません</p>
          <p className="text-xs text-gray-400 mt-1">「＋ 検証期間を追加」で過去・未来の期間を登録してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {periods.map(p => (
            <PeriodCard
              key={p.id}
              period={p}
              projectId={projectId}
              treeId={treeId}
              onDelete={deletePeriod}
              onEvaluate={evaluatePeriod}
            />
          ))}
        </div>
      )}
    </div>
  )
}
