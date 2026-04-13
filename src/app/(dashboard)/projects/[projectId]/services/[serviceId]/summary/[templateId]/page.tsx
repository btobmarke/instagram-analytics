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
  ServiceDetail, MetricCard, FormulaNode, FormulaStep, FormulaOperator,
  FormulaThresholdMode,
  TableRow, TimeUnit, SummaryTemplate,
} from '../_lib/types'
import { OPERATOR_SYMBOLS, TIME_UNIT_LABELS, formatFormula } from '../_lib/types'
import { getMetricCatalog } from '../_lib/catalog'
import { getTemplate, updateTemplate } from '../_lib/store'
import { generateJstDayPeriodLabels, generateCustomRangePeriod } from '@/lib/summary/jst-periods'

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

// ── 演算子ボタン ───────────────────────────────────────────────
function OperatorSelect({ value, onChange }: { value: FormulaOperator; onChange: (op: FormulaOperator) => void }) {
  return (
    <div className="flex items-center gap-1">
      {(Object.keys(OPERATOR_SYMBOLS) as FormulaOperator[]).map(op => (
        <button key={op} type="button" onClick={() => onChange(op)} className={`w-9 h-9 rounded-lg text-sm font-bold border-2 transition ${value === op ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'}`}>
          {OPERATOR_SYMBOLS[op]}
        </button>
      ))}
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
  const [steps, setSteps] = useState<FormulaStep[]>(editTarget?.formula?.steps ?? [{ operator: '+', operandId: '' }])
  const [thresholdMode, setThresholdMode] = useState<FormulaThresholdMode>(editTarget?.formula?.thresholdMode ?? 'none')
  const [thresholdValueStr, setThresholdValueStr] = useState(
    editTarget?.formula?.thresholdValue != null && !Number.isNaN(editTarget.formula.thresholdValue)
      ? String(editTarget.formula.thresholdValue)
      : '',
  )
  const findLabel = (id: string) => allCards.find(c => c.id === id)?.label ?? id
  const updateStep = (idx: number, patch: Partial<FormulaStep>) => setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  const addStep = () => setSteps(prev => [...prev, { operator: '+', operandId: '' }])
  const removeStep = (idx: number) => setSteps(prev => prev.filter((_, i) => i !== idx))
  const thresholdNum = Number(thresholdValueStr)
  const thresholdValid =
    !showThresholdControls ||
    thresholdMode === 'none' ||
    (thresholdValueStr.trim() !== '' && Number.isFinite(thresholdNum))
  const canSave = !!(name.trim() && baseOperandId && steps.every(s => s.operandId) && steps.length >= 1 && thresholdValid)
  const grouped = allCards.reduce<Record<string, MetricCard[]>>((acc, c) => { if (!c.formula) { ;(acc[c.category] ??= []).push(c) } return acc }, {})
  const previewFormula: FormulaNode | null = baseOperandId && steps.length > 0
    ? (() => {
        const f: FormulaNode = { baseOperandId, steps }
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
    const formula: FormulaNode = { baseOperandId, steps }
    if (showThresholdControls && thresholdMode !== 'none' && Number.isFinite(thresholdNum)) {
      formula.thresholdMode = thresholdMode
      formula.thresholdValue = thresholdNum
    }
    onSave({ id, label: name.trim(), category: 'カスタム指標', fieldRef: formatFormula(formula, findLabel, 'id'), formula })
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-900">{editTarget ? 'カスタム指標を編集' : 'カスタム指標を作成'}</h2>
          <p className="text-xs text-gray-500 mt-0.5">生フィールドを組み合わせて計算指標を定義（項は自由に追加可能）</p>
        </div>
        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">指標名</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例: エンゲージメント率" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">計算式</label>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center text-xs font-bold flex-shrink-0">A</span>
              <div className="flex-1"><FieldSelect value={baseOperandId} onChange={setBaseOperandId} grouped={grouped} /></div>
            </div>
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-2">
                <OperatorSelect value={step.operator} onChange={op => updateStep(idx, { operator: op })} />
                <div className="flex-1"><FieldSelect value={step.operandId} onChange={v => updateStep(idx, { operandId: v })} grouped={grouped} /></div>
                {steps.length > 1 && <button type="button" onClick={() => removeStep(idx)} className="w-7 h-7 rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 flex items-center justify-center transition flex-shrink-0"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>}
              </div>
            ))}
            <button type="button" onClick={addStep} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition mt-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              項を追加
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
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-[10px] text-gray-400 mb-1">プレビュー</p>
              <p className="text-sm font-medium text-gray-800">{name || '（指標名未入力）'}</p>
              <p className="text-xs text-gray-500 mt-1 font-mono">{formatFormula(previewFormula, findLabel)}</p>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
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
  const [customCards, setCustomCards] = useState<MetricCard[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    getTemplate(templateId, serviceId).then(tmpl => {
      if (!tmpl) { router.push(`/projects/${projectId}/services/${serviceId}/summary`); return }
      setTemplate(tmpl)
      setTemplateName(tmpl.name)
      setTimeUnit(tmpl.timeUnit)
      setRangeStart(tmpl.rangeStart?.slice(0, 10) ?? '')
      setRangeEnd(tmpl.rangeEnd?.slice(0, 10) ?? '')
      setCustomCards(tmpl.customCards)
      // rows を復元（セルは空状態）
      const headers = generateTimeHeaders(tmpl.timeUnit, 8, tmpl.rangeStart, tmpl.rangeEnd)
      setRows(tmpl.rows.map(r => ({ id: r.id, label: r.label, cells: Object.fromEntries(headers.map(h => [h, ''])) })))
    })
  }, [templateId, projectId, serviceId, router])

  // 保存
  const handleSave = useCallback(async () => {
    if (timeUnit === 'custom_range') {
      if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
        alert('期間指定では、開始日・終了日を YYYY-MM-DD で入力し、開始≦終了になるよう設定してください。')
        return
      }
    }
    setSaveState('saving')
    const storedRows = rows.map(r => {
      const custom = customCards.find(c => c.id === r.id)
      return { id: r.id, label: r.label, formula: custom?.formula }
    })
    await updateTemplate(templateId, serviceId, {
      name: templateName,
      timeUnit,
      rangeStart: timeUnit === 'custom_range' ? rangeStart : null,
      rangeEnd: timeUnit === 'custom_range' ? rangeEnd : null,
      rows: storedRows,
      customCards,
    })
    setIsDirty(false)
    setSaveState('saved')
    setTimeout(() => setSaveState('idle'), 2000)
  }, [templateId, serviceId, templateName, timeUnit, rangeStart, rangeEnd, rows, customCards])

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
    setRows(prev => [...prev, { id: c.id, label: c.label, cells: Object.fromEntries(timeHeaders.map(h => [h, ''])) }])
    setIsDirty(true)
  }
  const removeRowAt = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index))
    setIsDirty(true)
  }

  const handleSaveCustomCard = useCallback((card: MetricCard) => {
    setCustomCards(prev => { const idx = prev.findIndex(c => c.id === card.id); if (idx >= 0) { const n=[...prev]; n[idx]=card; return n } return [...prev, card] })
    setRows(prev => prev.map(r => r.id === card.id ? { ...r, label: card.label } : r))
    setIsDirty(true)
    setShowFormulaModal(false); setEditingCustomCard(null)
  }, [])
  const handleDeleteCustomCard = useCallback((id: string) => {
    setCustomCards(prev => prev.filter(c => c.id !== id))
    setRows(prev => prev.filter(r => r.id !== id))
    setIsDirty(true)
  }, [])

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
      <div className="p-6 max-w-6xl mx-auto">
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
            <button onClick={handleSave} className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg transition shadow-sm ${saveState === 'saved' ? 'bg-green-500 text-white' : isDirty ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-100 text-gray-400 cursor-default'}`}>
              {saveState === 'saving' ? '保存中...' : saveState === 'saved' ? '✓ 保存済み' : isDirty ? '保存' : '保存済み'}
            </button>
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
                    return (
                      <tr key={`row-${idx}-${row.id}`} className="border-b border-gray-100 hover:bg-gray-50/50">
                        <td className="sticky left-0 bg-white px-4 py-2.5 z-10">
                          <div className="text-xs font-medium text-gray-800">{row.label}</div>
                          {srcCard?.formula && <div className="text-[9px] text-amber-500 font-mono mt-0.5">{formatFormula(srcCard.formula, id => allCards.find(c => c.id === id)?.label ?? id)}</div>}
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
          showThresholdControls={serviceType === 'line'}
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
