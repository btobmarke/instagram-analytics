'use client'

/**
 * PresetAnalysisTab
 *
 * KPI ツリーのプリセット分析タブ。
 * - プルダウンでプリセットを選択
 * - 分析実行すると「指標×期間」のサマリテンプレートスタイルの表を表示
 * - 表の下に回帰方程式・影響度ランキングを表示
 */

import { useState, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { ValidationPeriodsPanel } from './ValidationPeriodsPanel'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 型 ──────────────────────────────────────────────────────────────────────

interface Coefficient {
  label: string
  coef:  number
  vif?:  number | null
}

interface WeightVersion {
  id:             string
  version_no:     number
  name:           string
  target_ref:     string
  feature_refs:   string[]
  coefficients:   Coefficient[]
  intercept:      number
  r2:             number
  n_obs:          number
  ridge_lambda:   number
  analysis_start: string
  analysis_end:   string
  time_unit:      string
}

interface PresetWithMeta {
  id:                  string
  name:                string
  target_metric_ref:   string
  feature_metric_refs: string[]
  is_stale:            boolean
  depth:               number
  latestWeight:        WeightVersion | null
}

interface AnalysisData {
  wideTable:   { date: string; [col: string]: number | null | string }[]
  columns:     string[]
  regression?: {
    target:       string
    features:     string[]
    coefficients: Coefficient[]
    intercept:    number
    r2:           number
    n:            number
    ridgeLambda:  number
  }
  warnings:    string[]
  savedWeightVersion?: WeightVersion | null
}

interface MetricOption {
  colKey:  string
  label:   string
  service: string
}

// ── ユーティリティ ────────────────────────────────────────────────────────────

function r2Color(r2: number): string {
  if (r2 >= 0.8) return 'text-green-700 bg-green-50 border-green-200'
  if (r2 >= 0.6) return 'text-blue-700 bg-blue-50 border-blue-200'
  if (r2 >= 0.4) return 'text-yellow-700 bg-yellow-50 border-yellow-200'
  return 'text-red-700 bg-red-50 border-red-200'
}

function formatValue(v: number | null): string {
  if (v == null) return '—'
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'k'
  if (Math.abs(v) < 1 && v !== 0) return v.toFixed(3)
  return v.toLocaleString('ja-JP', { maximumFractionDigits: 1 })
}

function formatDateHeader(dateStr: string, timeUnit: string): string {
  if (timeUnit === 'month') {
    const [y, m] = dateStr.split('-')
    return `${y}/${m}`
  }
  if (timeUnit === 'week') {
    const d = new Date(dateStr + 'T00:00:00Z')
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}週`
  }
  const d = new Date(dateStr + 'T00:00:00Z')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

// ── 指標×期間 サマリテーブル ─────────────────────────────────────────────────

function MetricTimeTable({
  wideTable, columns, targetRef, colLabel, timeUnit,
}: {
  wideTable:  AnalysisData['wideTable']
  columns:    string[]
  targetRef:  string
  colLabel:   (col: string) => string
  timeUnit:   string
}) {
  // 表示する最大列数（横スクロールで対応）
  const dates = wideTable.map(r => r.date as string).sort()
  // Y を先頭に、Xを後に
  const metricRows = [
    targetRef,
    ...columns.filter(c => c !== targetRef),
  ]

  if (dates.length === 0) {
    return <p className="text-xs text-gray-400 text-center py-8">データがありません</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {/* ロールバッジ列 */}
            <th className="sticky left-0 z-20 bg-gray-50 px-2 py-2.5 text-center text-gray-400 font-medium w-8 border-r border-gray-100">
              役
            </th>
            {/* 指標名列 */}
            <th className="sticky left-8 z-20 bg-gray-50 px-4 py-2.5 text-left text-xs font-bold text-gray-600 min-w-[180px] border-r border-gray-200">
              指標
            </th>
            {/* 日付列 */}
            {dates.map((d, i) => (
              <th key={d}
                className={`px-3 py-2.5 text-center text-[11px] font-medium min-w-[72px] whitespace-nowrap
                  ${i === dates.length - 1 ? 'text-gray-900 bg-blue-50 font-semibold' : 'text-gray-500'}`}>
                {formatDateHeader(d, timeUnit)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metricRows.map((col, rowIdx) => {
            const isTarget  = col === targetRef
            const rowValues = dates.map(d => {
              const row = wideTable.find(r => r.date === d)
              return row ? (row[col] as number | null) : null
            })
            // 最新値との変化率（最後の列のみ）
            const lastVal = rowValues[rowValues.length - 1]
            const prevVal = rowValues[rowValues.length - 2]
            const changePct = lastVal != null && prevVal != null && prevVal !== 0
              ? ((lastVal - prevVal) / Math.abs(prevVal)) * 100
              : null

            return (
              <tr key={col}
                className={`border-b border-gray-100 transition
                  ${isTarget ? 'bg-purple-50/60 hover:bg-purple-50' : rowIdx % 2 === 0 ? 'bg-white hover:bg-blue-50/20' : 'bg-gray-50/30 hover:bg-blue-50/20'}`}>
                {/* ロールバッジ */}
                <td className={`sticky left-0 z-10 px-2 py-2.5 text-center border-r border-gray-100
                  ${isTarget ? 'bg-purple-50/60' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded
                    ${isTarget ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {isTarget ? 'Y' : 'X'}
                  </span>
                </td>
                {/* 指標名 */}
                <td className={`sticky left-8 z-10 px-4 py-2.5 text-left border-r border-gray-200 font-medium
                  ${isTarget ? 'bg-purple-50/60 text-purple-800' : rowIdx % 2 === 0 ? 'bg-white text-gray-700' : 'bg-gray-50/30 text-gray-700'}`}>
                  <span className="truncate block max-w-[172px]" title={colLabel(col)}>
                    {colLabel(col)}
                  </span>
                </td>
                {/* データセル */}
                {rowValues.map((v, i) => {
                  const isLast = i === rowValues.length - 1
                  return (
                    <td key={i}
                      className={`px-3 py-2.5 text-center font-mono whitespace-nowrap
                        ${isLast ? 'bg-blue-50/60 font-semibold text-gray-900' : ''}
                        ${v == null ? 'text-gray-300' : isTarget ? 'text-purple-700' : 'text-gray-700'}`}>
                      {isLast && changePct != null ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span>{formatValue(v)}</span>
                          <span className={`text-[9px] font-normal ${changePct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {changePct >= 0 ? '▲' : '▼'}{Math.abs(changePct).toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        formatValue(v)
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 回帰結果パネル ────────────────────────────────────────────────────────────

function RegressionPanel({
  regression, colLabel,
}: {
  regression: NonNullable<AnalysisData['regression']>
  colLabel:   (col: string) => string
}) {
  const sorted = [...regression.coefficients].sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
  const maxAbs = Math.max(...sorted.map(c => Math.abs(c.coef)))

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-700">📐 回帰分析結果</h3>
        <div className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${r2Color(regression.r2)}`}>
          R² = {regression.r2.toFixed(3)}
        </div>
        <span className="text-xs text-gray-400">n={regression.n} ／ {regression.ridgeLambda > 0 ? `Ridge λ=${regression.ridgeLambda}` : 'OLS'}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* 回帰方程式 */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">回帰方程式</p>
          <div className="bg-gray-50 rounded-lg px-4 py-2.5 text-xs font-mono overflow-x-auto leading-relaxed">
            <span className="text-purple-700 font-semibold">{colLabel(regression.target)}</span>
            <span className="text-gray-600"> = {regression.intercept.toFixed(2)}</span>
            {sorted.map((c, i) => (
              <span key={i}>
                <span className="text-gray-500">{c.coef >= 0 ? ' + ' : ' − '}</span>
                <span className="font-semibold text-indigo-700">{Math.abs(c.coef).toFixed(4)}</span>
                <span className="text-gray-500"> × {colLabel(c.label)}</span>
              </span>
            ))}
          </div>
        </div>

        {/* 影響度ランキング */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">影響度ランキング（係数の絶対値）</p>
          <div className="space-y-2">
            {sorted.map((c, i) => {
              const barPct = maxAbs > 0 ? (Math.abs(c.coef) / maxAbs) * 100 : 0
              return (
                <div key={c.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-4 text-right flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-[11px] truncate ${i === 0 ? 'text-indigo-700 font-semibold' : 'text-gray-600'}`}
                        title={colLabel(c.label)}>
                        {colLabel(c.label)}
                      </span>
                      <span className={`text-[10px] font-mono ml-2 flex-shrink-0 ${c.coef >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                        {c.coef >= 0 ? '+' : ''}{c.coef.toFixed(4)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${c.coef >= 0 ? 'bg-blue-400' : 'bg-red-400'}`}
                        style={{ width: `${barPct}%` }} />
                    </div>
                  </div>
                  {c.vif != null && c.vif > 10 && (
                    <span className="text-[9px] text-orange-500 flex-shrink-0" title={`VIF=${c.vif}`}>⚠VIF</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── メインエクスポート ─────────────────────────────────────────────────────────

export function PresetAnalysisTab({
  projectId,
  treeId,
  metricOptions,
}: {
  projectId:     string
  treeId:        string | null
  metricOptions: MetricOption[]
}) {
  const today         = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [startDate,        setStartDate]        = useState(thirtyDaysAgo)
  const [endDate,          setEndDate]          = useState(today)
  const [timeUnit,         setTimeUnit]         = useState<'day' | 'week' | 'month'>('day')
  const [ridgeLambda,      setRidgeLambda]      = useState(0)
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')
  const [running,          setRunning]          = useState(false)
  const [runError,         setRunError]         = useState<string | null>(null)
  const [analysisData,     setAnalysisData]     = useState<AnalysisData | null>(null)
  const [savedMsg,         setSavedMsg]         = useState<string | null>(null)

  // プリセット一覧取得
  const { data: presetsResp, mutate: mutatePresets } = useSWR<{
    success: boolean
    data: { presets: PresetWithMeta[]; allAnalyzed: boolean }
  }>(
    treeId ? `/api/projects/${projectId}/preset-analysis?treeId=${treeId}` : null,
    fetcher,
  )
  const presets = presetsResp?.data?.presets ?? []

  const selectedPreset = useMemo(
    () => presets.find(p => p.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  )

  const colLabel = useCallback((col: string) => {
    const found = metricOptions.find(m => m.colKey === col)
    return found ? `${found.service}:${found.label}` : col
  }, [metricOptions])

  // 分析実行（データ取得 + 保存）
  const runAnalysis = async () => {
    if (!selectedPreset) return
    setRunning(true)
    setRunError(null)
    setSavedMsg(null)
    setAnalysisData(null)
    try {
      // 1. ワイドテーブル + 回帰を取得
      const res = await fetch(`/api/projects/${projectId}/analysis`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          targetMetricRef:   selectedPreset.target_metric_ref,
          featureMetricRefs: selectedPreset.feature_metric_refs,
          startDate,
          endDate,
          timeUnit,
          ridgeLambda,
          saveWeights: true,
          presetId:    selectedPreset.id,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'エラーが発生しました')
      setAnalysisData(json.data)
      if (json.data.savedWeightVersion) {
        setSavedMsg('✓ 分析結果を保存しました')
        mutatePresets()
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  // プリセット変更時は前の結果をクリア（前回保存済み結果は latestWeight から表示）
  const handlePresetChange = (id: string) => {
    setSelectedPresetId(id)
    setAnalysisData(null)
    setRunError(null)
    setSavedMsg(null)
  }

  if (!treeId) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
        <p className="text-sm text-gray-400">「KPI ツリー」タブでツリーを選択してください</p>
      </div>
    )
  }

  // 表示に使う回帰結果: 今回の分析結果 > 保存済み最新バージョン
  const displayAnalysis: AnalysisData | null = analysisData ?? (() => {
    const w = selectedPreset?.latestWeight
    if (!w) return null
    return {
      wideTable:  [],   // 過去の保存時のワイドデータは持っていないので空
      columns:    [w.target_ref, ...w.feature_refs],
      regression: {
        target:       w.target_ref,
        features:     w.feature_refs,
        coefficients: w.coefficients,
        intercept:    w.intercept,
        r2:           w.r2,
        n:            w.n_obs,
        ridgeLambda:  w.ridge_lambda,
      },
      warnings: [],
    }
  })()

  return (
    <div className="space-y-5">
      {/* ── 設定パネル ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">

        {/* プリセット選択 */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            分析プリセット
            {presets.length === 0 && (
              <span className="ml-2 text-gray-400 font-normal">（「KPIツリー」タブで「🔗 プリセット自動生成」を実行してください）</span>
            )}
          </label>
          <select
            value={selectedPresetId}
            onChange={e => handlePresetChange(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-purple-300">
            <option value="">プリセットを選択...</option>
            {presets.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_stale ? ' ⚠' : p.latestWeight ? ' ✓' : ''}
              </option>
            ))}
          </select>

          {/* 選択中プリセットの内容サマリ */}
          {selectedPreset && (
            <div className="mt-2 bg-purple-50 rounded-lg px-3 py-2 text-xs">
              <span className="font-semibold text-purple-800">Y: {colLabel(selectedPreset.target_metric_ref)}</span>
              <span className="mx-1.5 text-purple-400">←</span>
              <span className="text-purple-700">{selectedPreset.feature_metric_refs.map(colLabel).join(' + ')}</span>
              {selectedPreset.is_stale && (
                <span className="ml-2 text-orange-500 font-medium">⚠ ツリー変更あり（再分析推奨）</span>
              )}
              {selectedPreset.latestWeight && !selectedPreset.is_stale && (
                <span className="ml-2 text-green-600">✓ 分析済 (R²={selectedPreset.latestWeight.r2.toFixed(3)})</span>
              )}
            </div>
          )}
        </div>

        {/* 期間設定 */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">開始日</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">終了日</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">集計粒度</label>
            <select value={timeUnit} onChange={e => setTimeUnit(e.target.value as 'day' | 'week' | 'month')}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-purple-400">
              <option value="day">日次</option>
              <option value="week">週次</option>
              <option value="month">月次</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">Ridge λ</label>
              <span className="text-xs font-mono text-orange-600">{ridgeLambda === 0 ? 'OLS' : `λ=${ridgeLambda}`}</span>
            </div>
            <input type="range" min={0} max={20} step={0.5} value={ridgeLambda}
              onChange={e => setRidgeLambda(parseFloat(e.target.value))}
              className="w-full accent-orange-500" />
          </div>
          <button
            onClick={runAnalysis}
            disabled={!selectedPreset || running}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transition disabled:opacity-50 flex-shrink-0">
            {running ? '分析中...' : '▶ 分析実行'}
          </button>
        </div>

        {savedMsg && <p className="text-xs text-green-600">{savedMsg}</p>}
      </div>

      {/* ── エラー・警告 ─────────────────────────────────────────────── */}
      {runError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{runError}</div>
      )}
      {analysisData?.warnings && analysisData.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
          {analysisData.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700">⚠ {w}</p>)}
        </div>
      )}

      {/* ── データ表示エリア ──────────────────────────────────────────── */}
      {selectedPreset && (
        <>
          {/* 今回の分析結果テーブル */}
          {analysisData && analysisData.wideTable.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-semibold text-gray-700">
                  📊 {selectedPreset.name} — 時系列データ
                </h3>
                <span className="text-xs text-gray-400">
                  {analysisData.wideTable.length} {timeUnit === 'day' ? '日' : timeUnit === 'week' ? '週' : 'ヶ月'}
                </span>
              </div>
              <MetricTimeTable
                wideTable={analysisData.wideTable}
                columns={analysisData.columns}
                targetRef={selectedPreset.target_metric_ref}
                colLabel={colLabel}
                timeUnit={timeUnit}
              />
            </div>
          )}

          {/* 過去データがなく、保存済み結果がある場合のメッセージ */}
          {!analysisData && selectedPreset.latestWeight && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
              💡 保存済みの分析結果を表示しています（{selectedPreset.latestWeight.analysis_start} 〜 {selectedPreset.latestWeight.analysis_end}）。
              期間を指定して「▶ 分析実行」を押すと最新データで再分析できます。
            </div>
          )}

          {/* 未分析 + 未実行の場合 */}
          {!analysisData && !selectedPreset.latestWeight && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
              <p className="text-sm text-gray-400 mb-2">期間を設定して「▶ 分析実行」を押してください</p>
              <p className="text-xs text-gray-400">Y: {colLabel(selectedPreset.target_metric_ref)} ← {selectedPreset.feature_metric_refs.map(colLabel).join(' + ')}</p>
            </div>
          )}

          {/* 回帰結果 */}
          {displayAnalysis?.regression && (
            <RegressionPanel regression={displayAnalysis.regression} colLabel={colLabel} />
          )}
        </>
      )}

      {/* ── プリセット未選択時 ────────────────────────────────────────── */}
      {!selectedPreset && presets.length > 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <p className="text-sm text-gray-400">上のプルダウンから分析プリセットを選択してください</p>
        </div>
      )}

      {/* ── 検証期間 ─────────────────────────────────────────────────── */}
      <div className="pt-2 border-t border-gray-200">
        <ValidationPeriodsPanel projectId={projectId} treeId={treeId} />
      </div>
    </div>
  )
}
