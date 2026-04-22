'use client'

import { useState, useMemo, use, useId, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  DndContext, DragOverlay, useSensor, useSensors, PointerSensor,
  useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import type {
  ServiceDetail, MetricCard, FormulaNode, FormulaStep,
  FormulaBinaryOperator, FormulaNAryOperator, FormulaOperandTimeOp, FormulaThresholdMode,
  TableRow, TimeUnit, SummaryTemplate, StoredTemplateRow,
} from '../_lib/types'
import {
  OPERATOR_SYMBOLS, TIME_UNIT_LABELS, formatFormula, NARY_OPERATOR_LABELS, TIME_OP_LABELS,
} from '../_lib/types'
import { getMetricCatalog } from '../_lib/catalog'
import { getTemplate, updateTemplate } from '../_lib/store'
import { generateJstDayPeriodLabels, generateCustomRangePeriod } from '@/lib/summary/jst-periods'
import { DEFAULT_LINE_FRIENDS_ATTR_SLICES } from '@/lib/summary/line-friends-attr-default-slices'
import {
  DEFAULT_INSTAGRAM_FOLLOWER_DEMO_SLICES,
  DEFAULT_INSTAGRAM_ENGAGED_DEMO_SLICES,
} from '@/lib/summary/instagram-breakdown-default-slices'
import { buildFormulaPlainLanguageSummary } from '@/lib/summary/formula-humanize'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 指標説明ツールチップ ───────────────────────────────────────
function MetricTooltip({ description, isCustom }: { description?: string; isCustom: boolean }) {
  const [open, setOpen] = useState(false)
  if (!description) return null
  return (
    <div className="relative flex-shrink-0" style={{ zIndex: open ? 50 : 'auto' }}>
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={e => { e.stopPropagation(); e.preventDefault() }}
        className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold leading-none transition
          ${isCustom ? 'bg-amber-200 text-amber-600 hover:bg-amber-300' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}
      >
        ?
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 pointer-events-none">
          <div className="bg-gray-900 text-white text-[10px] leading-relaxed rounded-lg px-2.5 py-2 shadow-xl">
            {description}
          </div>
          <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  )
}

// ── ドラッグ可能カード ──────────────────────────────────────────
function DraggableCard({ card, isInTable, onEdit, onDelete }: {
  card: MetricCard; isInTable: boolean; onEdit?: () => void; onDelete?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id, data: { card } })
  const style = transform ? { transform: `translate(${transform.x}px,${transform.y}px)` } : undefined
  const isCustom = !!card.formula
  return (
    <div ref={setNodeRef} style={style} className={`group relative px-3 py-2 rounded-lg border text-xs font-medium select-none transition ${isDragging ? 'opacity-30' : ''} ${isInTable ? 'bg-gray-100 border-gray-200 text-gray-400 line-through cursor-default' : isCustom ? 'bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-400 hover:shadow-sm cursor-grab active:cursor-grabbing' : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300 hover:shadow-sm cursor-grab active:cursor-grabbing'}`}>
      <div {...listeners} {...attributes}>
        <span className={`text-[10px] block mb-0.5 ${isCustom ? 'text-amber-500' : 'text-gray-400'}`}>{card.category}</span>
        <div className="flex items-start gap-1">
          <span className="flex-1">{card.label}</span>
          <MetricTooltip description={card.description} isCustom={isCustom} />
        </div>
        <span className={`text-[9px] block mt-0.5 font-mono ${isCustom ? 'text-amber-400' : 'text-gray-300'}`}>
          {card.formula ? formatFormula(card.formula, id => id, 'id') : card.fieldRef}
        </span>
      </div>
      {isCustom && !isInTable && (
        <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5">
          {onEdit && <button onClick={e => { e.stopPropagation(); onEdit() }} className="w-4 h-4 rounded-full bg-amber-400 text-white flex items-center justify-center hover:bg-amber-500" title="編集"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>}
          {onDelete && <button onClick={e => { e.stopPropagation(); onDelete() }} className="w-4 h-4 rounded-full bg-red-400 text-white flex items-center justify-center hover:bg-red-500" title="削除"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>}
        </div>
      )}
    </div>
  )
}

// ── テーブルドロップゾーン ──────────────────────────────────────
function TableDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'table-drop-zone' })
  return (
    <div ref={setNodeRef} className={`min-h-[200px] rounded-xl border-2 transition ${isOver ? 'border-purple-400 bg-purple-50/50' : 'border-dashed border-gray-200 bg-white'}`}>
      {children}
    </div>
  )
}

// ── 時間軸ヘッダ生成 ───────────────────────────────────────────
function generateTimeHeaders(
  unit: TimeUnit,
  count: number,
  rangeStart?: string | null,
  rangeEnd?: string | null,
): string[] {
  if (unit === 'custom_range') {
    if (rangeStart && rangeEnd) return [generateCustomRangePeriod(rangeStart, rangeEnd).label]
    return ['（開始・終了日を設定）']
  }
  if (unit === 'day') return generateJstDayPeriodLabels(count)
  const headers: string[] = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    switch (unit) {
      case 'hour':  d.setHours(d.getHours() - i);   headers.push(`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`); break
      case 'week': { const s = new Date(d); s.setDate(d.getDate()-i*7); headers.push(`${s.getMonth()+1}/${s.getDate()}週`); break }
      case 'month': d.setMonth(d.getMonth() - i);   headers.push(`${d.getFullYear()}/${d.getMonth()+1}`); break
    }
  }
  return headers
}

// ── フィールド選択セレクト ──────────────────────────────────────
function FieldSelect({ value, onChange, grouped }: { value: string; onChange: (v: string) => void; grouped: Record<string, MetricCard[]> }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400">
      <option value="">フィールドを選択...</option>
      {Object.entries(grouped).map(([cat, cards]) => (
        <optgroup key={cat} label={cat}>
          {cards.map(c => <option key={c.id} value={c.id}>{c.label}（{c.fieldRef}）</option>)}
        </optgroup>
      ))}
    </select>
  )
}

// ── 演算子ボタン（四則＋ min/max/coalesce を横一列）────────────────
function OperatorSelect({ value, onChange }: { value: FormulaStep['operator']; onChange: (op: FormulaStep['operator']) => void }) {
  const sel =
    'border-amber-400 bg-amber-50 text-amber-700 shadow-sm'
  const idle =
    'border-gray-200 bg-white text-gray-500 hover:border-amber-200 hover:text-amber-700'
  const binary = (Object.keys(OPERATOR_SYMBOLS) as FormulaBinaryOperator[]).map(op => (
    <button
      key={op}
      type="button"
      onClick={() => onChange(op)}
      className={`shrink-0 w-9 min-h-[2.25rem] rounded-lg text-sm font-bold border-2 transition flex items-center justify-center ${value === op ? sel : idle}`}
    >
      {OPERATOR_SYMBOLS[op]}
    </button>
  ))
  const nary = ( ['min', 'max', 'coalesce'] as const satisfies readonly FormulaNAryOperator[]).map(op => (
    <button
      key={op}
      type="button"
      onClick={() => onChange(op)}
      className={`shrink-0 min-h-[2.25rem] px-2 rounded-lg text-[10px] font-bold border-2 transition flex items-center justify-center whitespace-nowrap ${value === op ? sel : idle}`}
    >
      {NARY_OPERATOR_LABELS[op]}
    </button>
  ))
  return (
    <div className="w-full min-w-0">
      <p className="text-[9px] text-gray-500 mb-1">
        ＋、−、×、÷、最小、最大、先頭の有効値（狭い画面では横スクロール）
      </p>
      <div className="flex flex-nowrap items-stretch gap-1 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
        {binary}
        {nary}
      </div>
    </div>
  )
}

function isNAryOp(op: FormulaStep['operator']): boolean {
  return op === 'min' || op === 'max' || op === 'coalesce'
}

function OperandValueRow({
  label,
  value,
  isConst,
  onChangeValue,
  onChangeIsConst,
  grouped,
  timeOp,
  onTimeOp,
  showTimeOp,
}: {
  label: string
  value: string
  isConst: boolean
  onChangeValue: (v: string) => void
  onChangeIsConst: (v: boolean) => void
  grouped: Record<string, MetricCard[]>
  timeOp: FormulaOperandTimeOp
  onTimeOp: (v: FormulaOperandTimeOp) => void
  showTimeOp: boolean
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-gray-600">{label}</span>
        <label className="flex items-center gap-1.5 text-[10px] text-gray-600 shrink-0">
          <input type="checkbox" checked={isConst} onChange={e => onChangeIsConst(e.target.checked)} className="rounded border-gray-300" />
          定数
        </label>
      </div>
      {showTimeOp && !isConst && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-gray-500 leading-snug">
            同じ指標を、表の<strong>横（列）</strong>のどこで読むか
          </span>
          <select
            value={timeOp}
            onChange={e => onTimeOp(e.target.value as FormulaOperandTimeOp)}
            className="w-full text-xs px-2.5 py-2 border border-gray-200 rounded-lg bg-white"
          >
            {(Object.keys(TIME_OP_LABELS) as FormulaOperandTimeOp[]).map(k => (
              <option key={k} value={k}>{TIME_OP_LABELS[k]}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] text-gray-500">
          {isConst ? '数値' : 'フィールド（指標）'}
        </span>
        {isConst ? (
          <input
            type="number"
            step="any"
            value={value}
            onChange={e => onChangeValue(e.target.value)}
            placeholder="例: 100"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        ) : (
          <FieldSelect value={value} onChange={onChangeValue} grouped={grouped} />
        )}
      </div>
    </div>
  )
}

// ── フォーミュラビルダーモーダル ───────────────────────────────
function FormulaBuilderModal({ catalog, customCards, editTarget, showThresholdControls, onSave, onClose }: {
  catalog: MetricCard[]; customCards: MetricCard[]; editTarget: MetricCard | null
  showThresholdControls?: boolean
  onSave: (card: MetricCard) => void; onClose: () => void
}) {
  const allCards = [...catalog, ...customCards]
  const [name, setName] = useState(editTarget?.label ?? '')
  const [baseOperandId, setBaseOperandId] = useState(editTarget?.formula?.baseOperandId ?? '')
  const [baseOperandIsConst, setBaseOperandIsConst] = useState(editTarget?.formula?.baseOperandIsConst ?? false)
  const [baseTimeOp, setBaseTimeOp] = useState<FormulaOperandTimeOp>(editTarget?.formula?.baseTimeOp ?? 'none')
  const [steps, setSteps] = useState<FormulaStep[]>(editTarget?.formula?.steps ?? [{ operator: '+', operandId: '', operandTimeOp: 'none' }])
  const [thresholdMode, setThresholdMode] = useState<FormulaThresholdMode>(editTarget?.formula?.thresholdMode ?? 'none')
  const [thresholdValueStr, setThresholdValueStr] = useState(
    editTarget?.formula?.thresholdValue != null && !Number.isNaN(editTarget.formula.thresholdValue)
      ? String(editTarget.formula.thresholdValue)
      : '',
  )
  const findLabel = (id: string) => allCards.find(c => c.id === id)?.label ?? id
  const updateStep = (idx: number, patch: Partial<FormulaStep>) => setSteps(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  const addStep = () => setSteps(prev => [...prev, { operator: '+', operandId: '', operandTimeOp: 'none' }])
  const removeStep = (idx: number) => setSteps(prev => prev.filter((_, i) => i !== idx))
  const thresholdNum = Number(thresholdValueStr)
  const thresholdValid =
    !showThresholdControls ||
    thresholdMode === 'none' ||
    (thresholdValueStr.trim() !== '' && Number.isFinite(thresholdNum))

  const operandOk = (id: string, isConst: boolean) => {
    if (isConst) return id.trim() !== '' && Number.isFinite(Number(id))
    return !!id
  }

  const stepsOk = steps.every((s) => {
    if (isNAryOp(s.operator)) {
      const extras = s.extraOperandIds ?? []
      if (!operandOk(s.operandId, Boolean(s.operandIsConst))) return false
      const flags = [Boolean(s.operandIsConst), ...((s.extraOperandsAreConst ?? []).map(Boolean))]
      for (let i = 0; i < extras.length; i++) {
        if (!operandOk(extras[i]!, flags[i + 1] ?? false)) return false
      }
      return true
    }
    return operandOk(s.operandId, Boolean(s.operandIsConst))
  })

  const baseOk = operandOk(baseOperandId, baseOperandIsConst)
  const canSave = !!(name.trim() && baseOk && steps.length >= 1 && stepsOk && thresholdValid)

  const grouped = allCards.reduce<Record<string, MetricCard[]>>((acc, c) => {
    if (!c.formula) { ;(acc[c.category] ??= []).push(c) }
    return acc
  }, {})

  const previewFormula: FormulaNode | null = baseOperandId && steps.length > 0
    ? (() => {
        const f: FormulaNode = {
          baseOperandId,
          baseOperandIsConst: baseOperandIsConst || undefined,
          baseTimeOp: !baseOperandIsConst && baseTimeOp !== 'none' ? baseTimeOp : undefined,
          steps,
        }
        if (showThresholdControls && thresholdMode !== 'none' && Number.isFinite(thresholdNum)) {
          f.thresholdMode = thresholdMode
          f.thresholdValue = thresholdNum
        }
        return f
      })()
    : null

  const handleSave = () => {
    if (!canSave) return
    const id = editTarget?.id ?? `custom.${Date.now()}`
    const formula: FormulaNode = {
      baseOperandId,
      baseOperandIsConst: baseOperandIsConst || undefined,
      baseTimeOp: !baseOperandIsConst && baseTimeOp !== 'none' ? baseTimeOp : undefined,
      steps,
    }
    if (showThresholdControls && thresholdMode !== 'none' && Number.isFinite(thresholdNum)) {
      formula.thresholdMode = thresholdMode
      formula.thresholdValue = thresholdNum
    }
    onSave({ id, label: name.trim(), category: 'カスタム指標', fieldRef: formatFormula(formula, findLabel, 'id'), formula })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-900">{editTarget ? 'カスタム指標を編集' : 'カスタム指標を作成'}</h2>
          <p className="text-xs text-gray-500 mt-0.5">四則演算に加え、前期差・定数・min/max/coalesce を利用できます。</p>
        </div>
        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">指標名</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例: 前日比、構成比（%）" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">ステップ 1（起点）</label>
            <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
              サマリ表の<strong>1マス</strong>ごとに計算します。「左の列」は表で<strong>すぐ左となりの列</strong>のことです（カレンダーの前日とは限りません）。
            </p>
            <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <OperandValueRow
                label="起点（A）"
                value={baseOperandId}
                isConst={baseOperandIsConst}
                onChangeValue={setBaseOperandId}
                onChangeIsConst={(v) => { setBaseOperandIsConst(v); if (v) setBaseTimeOp('none') }}
                grouped={grouped}
                timeOp={baseTimeOp}
                onTimeOp={setBaseTimeOp}
                showTimeOp={!baseOperandIsConst}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">ステップ 2 以降（演算）</label>
            <p className="text-[10px] text-gray-500 mb-2">
              上から順に適用します。<strong>＋</strong>と<strong>−</strong>だけは欠損を 0 とみなして計算します（詳しくは下の注記）。
            </p>
            {steps.map((step, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 mb-3 space-y-3 last:mb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-gray-600">ステップ {idx + 2}</span>
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStep(idx)}
                      className="text-[10px] text-gray-400 hover:text-red-500 px-2 py-1 rounded border border-transparent hover:border-red-200 transition"
                      title="この段を削除"
                    >
                      削除
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] text-gray-500">演算</span>
                  <OperatorSelect
                    value={step.operator}
                    onChange={op => {
                      if (isNAryOp(op)) {
                        updateStep(idx, {
                          operator: op,
                          extraOperandIds: step.extraOperandIds?.length ? step.extraOperandIds : [],
                          extraOperandsAreConst: step.extraOperandsAreConst,
                          operandTimeOp: 'none',
                        })
                      } else {
                        updateStep(idx, { operator: op, extraOperandIds: undefined, extraOperandsAreConst: undefined })
                      }
                    }}
                  />
                </div>
                {isNAryOp(step.operator) ? (
                  <div className="space-y-3 pt-1 border-t border-gray-200/80">
                    <OperandValueRow
                      label="引数 1"
                      value={step.operandId}
                      isConst={Boolean(step.operandIsConst)}
                      onChangeValue={v => updateStep(idx, { operandId: v })}
                      onChangeIsConst={v => updateStep(idx, { operandIsConst: v || undefined, operandTimeOp: v ? 'none' : step.operandTimeOp })}
                      grouped={grouped}
                      timeOp={step.operandTimeOp ?? 'none'}
                      onTimeOp={v => updateStep(idx, { operandTimeOp: v })}
                      showTimeOp={!step.operandIsConst}
                    />
                    {(step.extraOperandIds ?? []).map((ex, j) => (
                      <OperandValueRow
                        key={j}
                        label={`引数 ${j + 2}`}
                        value={ex}
                        isConst={Boolean(step.extraOperandsAreConst?.[j])}
                        onChangeValue={v => {
                          const next = [...(step.extraOperandIds ?? [])]
                          next[j] = v
                          updateStep(idx, { extraOperandIds: next })
                        }}
                        onChangeIsConst={v => {
                          const nextF = [...(step.extraOperandsAreConst ?? [])]
                          while (nextF.length <= j) nextF.push(false)
                          nextF[j] = v
                          updateStep(idx, { extraOperandsAreConst: nextF })
                        }}
                        grouped={grouped}
                        timeOp="none"
                        onTimeOp={() => {}}
                        showTimeOp={false}
                      />
                    ))}
                    <button
                      type="button"
                      className="w-full text-left text-[10px] text-amber-600 hover:text-amber-700 py-1"
                      onClick={() => {
                        const next = [...(step.extraOperandIds ?? []), '']
                        const nextF = [...(step.extraOperandsAreConst ?? [])]
                        nextF.push(false)
                        updateStep(idx, { extraOperandIds: next, extraOperandsAreConst: nextF })
                      }}
                    >
                      + 引数を追加（3項以上の min / max / coalesce）
                    </button>
                  </div>
                ) : (
                  <div className="pt-1 border-t border-gray-200/80">
                    <OperandValueRow
                      label="右辺の値"
                      value={step.operandId}
                      isConst={Boolean(step.operandIsConst)}
                      onChangeValue={v => updateStep(idx, { operandId: v })}
                      onChangeIsConst={v => updateStep(idx, { operandIsConst: v || undefined, operandTimeOp: v ? 'none' : step.operandTimeOp })}
                      grouped={grouped}
                      timeOp={step.operandTimeOp ?? 'none'}
                      onTimeOp={v => updateStep(idx, { operandTimeOp: v })}
                      showTimeOp={!step.operandIsConst}
                    />
                  </div>
                )}
              </div>
            ))}
            <button type="button" onClick={addStep} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition mt-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              演算ステップを追加
            </button>
          </div>
          {showThresholdControls && (
            <div className="rounded-lg border border-green-200 bg-green-50/50 px-3 py-3 space-y-2">
              <p className="text-xs font-medium text-gray-700">表示条件（計算後の値）</p>
              <p className="text-[10px] text-gray-500">条件を満たさないセルはサマリーで「—」になります。</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={thresholdMode}
                  onChange={e => setThresholdMode(e.target.value as FormulaThresholdMode)}
                  className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="none">条件なし（常に表示）</option>
                  <option value="gte">閾値以上のときだけ表示</option>
                  <option value="lte">閾値以下のときだけ表示</option>
                </select>
                {(thresholdMode === 'gte' || thresholdMode === 'lte') && (
                  <input
                    type="number"
                    step="any"
                    value={thresholdValueStr}
                    onChange={e => setThresholdValueStr(e.target.value)}
                    placeholder="閾値"
                    className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                )}
              </div>
            </div>
          )}
          {previewFormula && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
              <p className="text-[10px] text-gray-400">プレビュー</p>
              <p className="text-sm font-medium text-gray-800">{name || '（指標名未入力）'}</p>
              <div className="rounded-md bg-white border border-amber-100 px-3 py-2">
                <p className="text-[10px] font-medium text-amber-800 mb-1">この指標の意味（各セル）</p>
                <p className="text-xs text-gray-700 leading-relaxed">{buildFormulaPlainLanguageSummary(previewFormula, findLabel)}</p>
              </div>
              <p className="text-[10px] text-gray-500 font-mono break-all">内部参照: {formatFormula(previewFormula, findLabel, 'id')}</p>
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/80 space-y-1.5 flex-shrink-0">
          <p className="text-[10px] text-gray-600 leading-relaxed">
            <strong>左端の列</strong>では「左の列の同じ指標」や「この列 − 左の列」はデータがなく <strong>—</strong> になることがあります。
          </p>
          <p className="text-[10px] text-gray-600 leading-relaxed">
            <strong>＋ / −</strong> のあとに <strong>+ 0</strong> などを続けると、欠損（—）が <strong>0 として足し込まれる</strong>ため、左端が 0 に見えることがあります。差分だけを — のまま残したい場合は <strong>+0 を付けない</strong>でください。
          </p>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">キャンセル</button>
          <button onClick={handleSave} disabled={!canSave} className={`px-5 py-2 text-sm font-medium rounded-lg transition ${canSave ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
            {editTarget ? '更新' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── メインコンポーネント ───────────────────────────────────────
export default function TemplateEditorPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string; templateId: string }>
}) {
  const { projectId, serviceId, templateId } = use(params)
  const router = useRouter()
  const dndId = useId()

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(`/api/services/${serviceId}`, fetcher)
  const service = svcData?.data
  const serviceType = service?.service_type ?? ''

  const catalog = getMetricCatalog(serviceType)

  // テンプレート読み込み
  const [template, setTemplate] = useState<SummaryTemplate | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [rows, setRows] = useState<TableRow[]>([])
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('day')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    getTemplate(templateId, serviceId).then(tmpl => {
      if (!tmpl) { router.push(`/projects/${projectId}/services/${serviceId}/summary`); return }
      setTemplate(tmpl)
      setTemplateName(tmpl.name)
      setTimeUnit(tmpl.timeUnit)
      setRangeStart(tmpl.rangeStart?.slice(0, 10) ?? '')
      setRangeEnd(tmpl.rangeEnd?.slice(0, 10) ?? '')
      // rows を復元（セルは空状態）
      const headers = generateTimeHeaders(tmpl.timeUnit, 8, tmpl.rangeStart, tmpl.rangeEnd)
      setRows(
        tmpl.rows.map(r => ({
          id: r.id,
          label: r.label,
          rowKind: r.rowKind ?? 'scalar',
          breakdown: r.breakdown,
          cells: Object.fromEntries(headers.map(h => [h, ''])),
        })),
      )
    })
  }, [templateId, projectId, serviceId, router])

  // ── カスタム指標ライブラリ（サービス単位） ────────────────────
  interface LibraryMetric { id: string; service_id: string; name: string; formula: MetricCard['formula'] }
  const { data: libraryResp, mutate: mutateLibrary } = useSWR<{ success: boolean; data: LibraryMetric[] }>(
    serviceId ? `/api/services/${serviceId}/custom-metrics` : null,
    fetcher,
  )
  const customCards: MetricCard[] = useMemo(
    () => (libraryResp?.data ?? []).map(m => ({
      id:       m.id,
      label:    m.name,
      category: 'カスタム指標',
      fieldRef: m.id,
      formula:  m.formula as MetricCard['formula'],
    })),
    [libraryResp],
  )

  // 保存
  const handleSave = useCallback(async () => {
    if (timeUnit === 'custom_range') {
      if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
        alert('期間指定では、開始日・終了日を YYYY-MM-DD で入力し、開始≦終了になるよう設定してください。')
        return
      }
    }
    setSaveState('saving')
    setSaveError(null)
    // カスタム指標はライブラリで管理するため formula を rows に埋め込まない
    const storedRows: StoredTemplateRow[] = rows.map((r) => {
      if (r.rowKind === 'breakdown' && r.breakdown) {
        return { id: r.id, label: r.label, rowKind: 'breakdown', breakdown: r.breakdown }
      }
      return { id: r.id, label: r.label, rowKind: 'scalar' }
    })
    try {
      await updateTemplate(templateId, serviceId, {
        name: templateName,
        timeUnit,
        rangeStart: timeUnit === 'custom_range' ? rangeStart : null,
        rangeEnd: timeUnit === 'custom_range' ? rangeEnd : null,
        rows: storedRows,
        customCards: [],  // ライブラリ移行後は空配列
      })
      setIsDirty(false)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存に失敗しました'
      setSaveError(msg)
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 4000)
    }
  }, [templateId, serviceId, templateName, timeUnit, rangeStart, rangeEnd, rows])

  // フィルタ・タブ・アコーディオン
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<string>('all')
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set())
  const [showFormulaModal, setShowFormulaModal] = useState(false)
  const [editingCustomCard, setEditingCustomCard] = useState<MetricCard | null>(null)

  const allCards = [...catalog, ...customCards]
  const TIME_COL_COUNT = 8
  const timeHeaders = useMemo(
    () => generateTimeHeaders(timeUnit, TIME_COL_COUNT, rangeStart, rangeEnd),
    [timeUnit, rangeStart, rangeEnd],
  )
  const timeColCount = timeUnit === 'custom_range' ? timeHeaders.length : TIME_COL_COUNT
  const addedIds = new Set(rows.map(r => r.id))

  const categories = useMemo(() => {
    const cats: string[] = []
    for (const c of catalog) { if (!cats.includes(c.category)) cats.push(c.category) }
    return cats
  }, [catalog])

  const filteredCatalog = useMemo(() => {
    let cards = catalog
    if (activeTab !== 'all') cards = cards.filter(c => c.category === activeTab)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      cards = cards.filter(c => c.label.toLowerCase().includes(q) || c.fieldRef.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
    }
    return cards
  }, [catalog, activeTab, searchQuery])

  const groupedFiltered = useMemo(() => {
    const map: Record<string, MetricCard[]> = {}
    for (const c of filteredCatalog) { ;(map[c.category] ??= []).push(c) }
    return map
  }, [filteredCatalog])

  const toggleCategory = useCallback((cat: string) => {
    setOpenCategories(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n })
  }, [])
  const toggleAllCategories = useCallback(() => {
    const cats = Object.keys(groupedFiltered)
    setOpenCategories(prev => cats.every(c => prev.has(c)) ? new Set() : new Set(cats))
  }, [groupedFiltered])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [activeCard, setActiveCard] = useState<MetricCard | null>(null)

  const handleDragStart = (e: DragStartEvent) => {
    const c = e.active.data.current?.card as MetricCard | undefined
    if (c) setActiveCard(c)
  }
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveCard(null)
    const { active, over } = e
    if (!over || over.id !== 'table-drop-zone') return
    const c = active.data.current?.card as MetricCard | undefined
    if (!c || addedIds.has(c.id)) return
    setRows(prev => [...prev, {
      id: c.id,
      label: c.label,
      rowKind: 'scalar',
      cells: Object.fromEntries(timeHeaders.map(h => [h, ''])),
    }])
    setIsDirty(true)
  }
  const removeRowAt = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index))
    setIsDirty(true)
  }

  const handleSaveCustomCard = useCallback(async (card: MetricCard) => {
    if (!card.formula) return
    const isExisting = customCards.some(c => c.id === card.id)
    if (isExisting) {
      // 既存指標を更新
      await fetch(`/api/services/${serviceId}/custom-metrics/${card.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: card.label, formula: card.formula }),
      })
      // テーブル内の行ラベルも同期
      setRows(prev => prev.map(r => r.id === card.id ? { ...r, label: card.label } : r))
    } else {
      // 新規作成
      const res = await fetch(`/api/services/${serviceId}/custom-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: card.label, formula: card.formula }),
      })
      const json = await res.json()
      if (json.success) {
        // 新しい DB ID でテーブルに追加（ドラッグして追加する前に確認ができるよう行には追加しない）
        const newId = json.data.id
        // もし元の card.id（仮 ID）がすでにテーブルの行にあれば ID を差し替え
        setRows(prev => prev.map(r => r.id === card.id ? { ...r, id: newId, label: card.label } : r))
      }
    }
    await mutateLibrary()
    setIsDirty(true)
    setShowFormulaModal(false); setEditingCustomCard(null)
  }, [serviceId, customCards, mutateLibrary])

  const handleDeleteCustomCard = useCallback(async (id: string) => {
    await fetch(`/api/services/${serviceId}/custom-metrics/${id}`, { method: 'DELETE' })
    await mutateLibrary()
    setRows(prev => prev.filter(r => r.id !== id))
    setIsDirty(true)
  }, [serviceId, mutateLibrary])

  const themeColor: Record<string, { bg: string; border: string }> = {
    instagram: { bg: 'bg-pink-50',   border: 'border-pink-200' },
    gbp:       { bg: 'bg-teal-50',   border: 'border-teal-200' },
    line:      { bg: 'bg-green-50',  border: 'border-green-200' },
    lp:        { bg: 'bg-purple-50', border: 'border-purple-200' },
  }
  const theme = themeColor[serviceType] ?? { bg: 'bg-purple-50', border: 'border-purple-200' }

  if (!template) return <div className="p-8 text-center text-gray-400 text-sm">読み込み中...</div>

  return (
    <DndContext id={dndId} sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="p-6 w-full max-w-none min-w-0">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
          <Link href={`/projects/${projectId}`} className="hover:text-purple-600">{service?.project?.project_name ?? 'プロジェクト'}</Link>
          <Chevron />
          <Link href={`/projects/${projectId}/services/${serviceId}/summary`} className="hover:text-purple-600">{service?.service_name ?? '...'} / サマリーテンプレート</Link>
          <Chevron />
          <span className="text-gray-700 font-medium">{templateName}</span>
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={templateName}
              onChange={e => { setTemplateName(e.target.value); setIsDirty(true) }}
              className="text-xl font-bold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-purple-400 focus:outline-none px-0 py-0.5 w-full"
            />
            <p className="text-xs text-gray-500 mt-1">カードをテーブルにドラッグして項目を追加 · 編集後は保存ボタンを押してください</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* 横軸 */}
            <select value={timeUnit} onChange={e => { setTimeUnit(e.target.value as TimeUnit); setIsDirty(true) }} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
              {(Object.keys(TIME_UNIT_LABELS) as TimeUnit[]).map(u => <option key={u} value={u}>{TIME_UNIT_LABELS[u]}</option>)}
            </select>
            {timeUnit === 'custom_range' && (
              <span className="flex items-center gap-1.5 flex-wrap">
                <input
                  type="date"
                  value={rangeStart}
                  onChange={e => { setRangeStart(e.target.value); setIsDirty(true) }}
                  className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <span className="text-xs text-gray-500">〜</span>
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={e => { setRangeEnd(e.target.value); setIsDirty(true) }}
                  className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </span>
            )}
            {/* サマリーを見る */}
            <Link href={`/projects/${projectId}/services/${serviceId}/summary/${templateId}/view`} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              サマリーを見る
            </Link>
            {/* 保存 */}
            <div className="flex flex-col items-end gap-0.5">
              <button
                onClick={handleSave}
                disabled={saveState === 'saving'}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg transition shadow-sm ${
                  saveState === 'saved'  ? 'bg-green-500 text-white' :
                  saveState === 'error'  ? 'bg-red-500 text-white' :
                  saveState === 'saving' ? 'bg-gray-300 text-gray-500 cursor-not-allowed' :
                  isDirty ? 'bg-purple-600 text-white hover:bg-purple-700' :
                  'bg-gray-100 text-gray-400 cursor-default'
                }`}
              >
                {saveState === 'saving' ? '保存中...' : saveState === 'saved' ? '✓ 保存済み' : saveState === 'error' ? '✗ 保存失敗' : isDirty ? '保存' : '保存済み'}
              </button>
              {saveState === 'error' && saveError && (
                <p className="text-[10px] text-red-600 max-w-[200px] text-right">{saveError}</p>
              )}
            </div>
          </div>
        </div>

        {/* カードエリア */}
        <div className={`rounded-xl border ${theme.border} ${theme.bg} mb-6 overflow-hidden`}>
          <div className="px-4 pt-4 pb-2 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="フィールドを検索..." className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-400" />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>}
              </div>
              <button onClick={toggleAllCategories} className="px-2 py-1.5 text-[10px] text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition whitespace-nowrap">
                {Object.keys(groupedFiltered).every(c => openCategories.has(c)) ? '全て閉じる' : '全て開く'}
              </button>
              <button onClick={() => { setEditingCustomCard(null); setShowFormulaModal(true) }} className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition shadow-sm whitespace-nowrap">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                カスタム指標
              </button>
              {serviceType === 'line' && (
                <button
                  type="button"
                  onClick={() => {
                    const id = `breakdown.line_oam_friends_attr.${Date.now()}`
                    setRows(prev => [...prev, {
                      id,
                      label: 'LINE 友だち属性（内訳）',
                      rowKind: 'breakdown',
                      breakdown: {
                        table: 'line_oam_friends_attr',
                        valueField: 'percentage',
                        slices: [...DEFAULT_LINE_FRIENDS_ATTR_SLICES],
                      },
                      cells: Object.fromEntries(timeHeaders.map(h => [h, ''])),
                    }])
                    setIsDirty(true)
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm whitespace-nowrap"
                >
                  内訳行を追加
                </button>
              )}
              {serviceType === 'instagram' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const id = `breakdown.ig.follower.${Date.now()}`
                      setRows(prev => [...prev, {
                        id,
                        label: 'フォロワー層（内訳・lifetime）',
                        rowKind: 'breakdown',
                        breakdown: {
                          table: 'ig_account_insight_fact',
                          metricCode: 'follower_demographics',
                          period: 'lifetime',
                          valueField: 'value',
                          slices: [...DEFAULT_INSTAGRAM_FOLLOWER_DEMO_SLICES],
                        },
                        cells: Object.fromEntries(timeHeaders.map(h => [h, ''])),
                      }])
                      setIsDirty(true)
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg bg-pink-600 text-white hover:bg-pink-700 transition shadow-sm whitespace-nowrap"
                  >
                    内訳（フォロワー層）
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const id = `breakdown.ig.engaged.${Date.now()}`
                      setRows(prev => [...prev, {
                        id,
                        label: 'エンゲージ層（内訳・lifetime）',
                        rowKind: 'breakdown',
                        breakdown: {
                          table: 'ig_account_insight_fact',
                          metricCode: 'engaged_audience_demographics',
                          period: 'lifetime',
                          valueField: 'value',
                          slices: [...DEFAULT_INSTAGRAM_ENGAGED_DEMO_SLICES],
                        },
                        cells: Object.fromEntries(timeHeaders.map(h => [h, ''])),
                      }])
                      setIsDirty(true)
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 transition shadow-sm whitespace-nowrap"
                  >
                    内訳（エンゲージ層）
                  </button>
                </>
              )}
            </div>
            {/* カテゴリタブ */}
            <div className="flex gap-1 overflow-x-auto pb-1">
              <button onClick={() => setActiveTab('all')} className={`px-2.5 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition ${activeTab === 'all' ? 'bg-white text-gray-800 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'}`}>
                すべて（{catalog.length}）
              </button>
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveTab(cat === activeTab ? 'all' : cat)} className={`px-2.5 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition ${activeTab === cat ? 'bg-white text-gray-800 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'}`}>
                  {cat}（{catalog.filter(c => c.category === cat).length}）
                </button>
              ))}
              {customCards.length > 0 && (
                <button onClick={() => setActiveTab(activeTab === '__custom__' ? 'all' : '__custom__')} className={`px-2.5 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition ${activeTab === '__custom__' ? 'bg-amber-100 text-amber-800 shadow-sm border border-amber-200' : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'}`}>
                  カスタム（{customCards.length}）
                </button>
              )}
            </div>
          </div>

          {/* カード一覧（高さ制限） */}
          <div className="px-4 pb-4 max-h-[280px] overflow-y-auto">
            {catalog.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">サービス情報を読み込み中...</p>
            ) : activeTab === '__custom__' ? (
              customCards.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">まだカスタム指標はありません。</p> : (
                <div className="flex flex-wrap gap-2 py-2">
                  {customCards.map(c => <DraggableCard key={c.id} card={c} isInTable={addedIds.has(c.id)} onEdit={() => { setEditingCustomCard(c); setShowFormulaModal(true) }} onDelete={() => handleDeleteCustomCard(c.id)} />)}
                </div>
              )
            ) : filteredCatalog.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">「{searchQuery}」に一致するフィールドはありません</p>
            ) : (
              <div className="space-y-1 py-1">
                {Object.entries(groupedFiltered).map(([cat, cards]) => {
                  const isOpen = openCategories.has(cat)
                  const addedCount = cards.filter(c => addedIds.has(c.id)).length
                  return (
                    <div key={cat} className="rounded-lg border border-gray-200/60 bg-white/60">
                      <button onClick={() => toggleCategory(cat)} className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-white/80 transition rounded-lg">
                        <span className="flex items-center gap-2">
                          <svg className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          <span className="font-medium text-gray-700">{cat}</span>
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {addedCount > 0 && <span className="text-purple-500 mr-1">{addedCount}件追加済</span>}
                          {cards.length}件
                        </span>
                      </button>
                      {isOpen && <div className="px-3 pb-2.5 pt-0.5 flex flex-wrap gap-1.5">{cards.map(c => <DraggableCard key={c.id} card={c} isInTable={addedIds.has(c.id)} />)}</div>}
                    </div>
                  )
                })}
                {activeTab === 'all' && customCards.length > 0 && (
                  <div className="rounded-lg border border-amber-200/60 bg-amber-50/40">
                    <button onClick={() => toggleCategory('__custom__')} className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-amber-50/80 transition rounded-lg">
                      <span className="flex items-center gap-2">
                        <svg className={`w-3 h-3 text-amber-400 transition-transform ${openCategories.has('__custom__') ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        <span className="font-medium text-amber-700">カスタム指標</span>
                      </span>
                      <span className="text-[10px] text-amber-400">{customCards.length}件</span>
                    </button>
                    {openCategories.has('__custom__') && <div className="px-3 pb-2.5 pt-0.5 flex flex-wrap gap-1.5">{customCards.map(c => <DraggableCard key={c.id} card={c} isInTable={addedIds.has(c.id)} onEdit={() => { setEditingCustomCard(c); setShowFormulaModal(true) }} onDelete={() => handleDeleteCustomCard(c.id)} />)}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* テーブル */}
        <TableDropZone>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <svg className="w-10 h-10 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              <p className="text-sm font-medium">指標カードをここにドロップ</p>
              <p className="text-xs mt-1">テーブルの縦軸に項目が追加されます</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="sticky left-0 bg-gray-50 px-4 py-2.5 text-left text-xs font-bold text-gray-600 min-w-[180px] z-10">項目</th>
                    {timeHeaders.map(h => <th key={h} className="px-3 py-2.5 text-center text-[11px] font-medium text-gray-500 min-w-[90px] whitespace-nowrap">{h}</th>)}
                    <th className="px-2 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const srcCard = allCards.find(c => c.id === row.id)
                    const isBd = row.rowKind === 'breakdown'
                    return (
                      <tr key={`row-${idx}-${row.id}`} className="border-b border-gray-100 hover:bg-gray-50/50">
                        <td className="sticky left-0 bg-white px-4 py-2.5 z-10">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-xs font-medium text-gray-800">{row.label}</div>
                            {isBd && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                                row.breakdown?.table === 'ig_account_insight_fact'
                                  ? 'bg-pink-100 text-pink-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}>内訳</span>
                            )}
                          </div>
                          {srcCard?.formula && <div className="text-[9px] text-amber-500 font-mono mt-0.5">{formatFormula(srcCard.formula, id => allCards.find(c => c.id === id)?.label ?? id)}</div>}
                          {isBd && row.breakdown && (
                            <div className="text-[9px] text-gray-500 mt-0.5">{row.breakdown.slices.length} スライス（保存でテンプレに記録）</div>
                          )}
                        </td>
                        {timeHeaders.map(h => <td key={h} className="px-3 py-2.5 text-center text-xs text-gray-400">—</td>)}
                        <td className="px-2 py-2.5 text-center">
                          <button onClick={() => removeRowAt(idx)} className="text-gray-300 hover:text-red-500 transition" title="行を削除">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TableDropZone>

        {rows.length > 0 && (
          <p className="text-[10px] text-gray-400 mt-3 text-right">
            {rows.length} 項目 × {timeColCount}{' '}
            {timeUnit === 'custom_range' && rangeStart && rangeEnd
              ? generateCustomRangePeriod(rangeStart, rangeEnd).label
              : TIME_UNIT_LABELS[timeUnit]}
          </p>
        )}
      </div>

      {/* ドラッグオーバーレイ */}
      <DragOverlay>
        {activeCard && (
          <div className={`px-3 py-2 rounded-lg border text-xs font-medium shadow-lg ${activeCard.formula ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-purple-400 bg-purple-50 text-purple-700'}`}>
            <span className={`text-[10px] block mb-0.5 ${activeCard.formula ? 'text-amber-400' : 'text-purple-400'}`}>{activeCard.category}</span>
            {activeCard.label}
          </div>
        )}
      </DragOverlay>

      {/* フォーミュラビルダーモーダル */}
      {showFormulaModal && (
        <FormulaBuilderModal
          catalog={catalog}
          customCards={customCards}
          editTarget={editingCustomCard}
          showThresholdControls={serviceType === 'gbp' || serviceType === 'line' || serviceType === 'instagram'}
          onSave={handleSaveCustomCard}
          onClose={() => { setShowFormulaModal(false); setEditingCustomCard(null) }}
        />
      )}
    </DndContext>
  )
}

function Chevron() {
  return <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
}
