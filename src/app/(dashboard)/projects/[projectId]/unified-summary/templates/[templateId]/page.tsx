'use client'

import { useState, use, useEffect, useCallback, useId, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  DndContext, DragOverlay, useSensor, useSensors, PointerSensor,
  useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { UnifiedTableRow, ProjectSummaryTemplate, TimeUnit } from '../../_lib/types'
import { SERVICE_TYPE_INFO, TIME_UNIT_LABELS, TIME_UNIT_DEFAULT_COUNT } from '../../_lib/types'
import { getTemplate, updateTemplate, deleteTemplate } from '../../_lib/store'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'
import { generateJstDayPeriodLabels, generateCustomRangePeriod } from '@/lib/summary/jst-periods'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 型 ────────────────────────────────────────────────────────────────────────

interface ConfigService {
  id: string
  name: string
  serviceType: string
  availableMetrics: { id: string; label: string; category: string; fieldRef: string }[]
}

// ── 時間軸ヘッダ生成 ──────────────────────────────────────────────────────────

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
      case 'hour':  d.setHours(d.getHours() - i); headers.push(`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`); break
      case 'week': { const s = new Date(d); s.setDate(d.getDate()-i*7); headers.push(`${s.getMonth()+1}/${s.getDate()}週`); break }
      case 'month': d.setMonth(d.getMonth() - i); headers.push(`${d.getFullYear()}/${d.getMonth()+1}`); break
    }
  }
  return headers
}

// ── ドラッグ可能カード（左パネル） ────────────────────────────────────────────

function DraggableCard({ card, serviceType, alreadyAdded, isCustom = false }: {
  card: { id: string; label: string; category: string; fieldRef: string }
  serviceType: string
  alreadyAdded: boolean
  isCustom?: boolean
}) {
  const theme = SERVICE_TYPE_INFO[serviceType]
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `card::${serviceType}::${card.id}`,
    data: { card, serviceType, isCustom },
    disabled: alreadyAdded,
  })
  const style = transform ? { transform: `translate(${transform.x}px,${transform.y}px)` } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`px-3 py-2 rounded-lg border text-xs font-medium select-none transition
        ${isDragging ? 'opacity-30' : ''}
        ${alreadyAdded
          ? 'bg-gray-50 border-gray-200 text-gray-400 line-through cursor-default'
          : isCustom
            ? 'bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-400 hover:shadow-sm cursor-grab active:cursor-grabbing'
            : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300 hover:shadow-sm cursor-grab active:cursor-grabbing'
        }`}
    >
      <div className={`text-[10px] mb-0.5 ${isCustom ? 'text-amber-500' : (theme?.color ?? 'text-gray-400')}`}>
        {isCustom ? '✦' : (theme?.icon ?? '')} {card.category}
      </div>
      <div className="font-medium">{card.label}</div>
      {!isCustom && <div className="text-[9px] text-gray-300 font-mono mt-0.5">{card.fieldRef}</div>}
    </div>
  )
}

// ── ソータブル行（右テーブル） ────────────────────────────────────────────────

function SortableRow({ row, timeHeaders, values, onRemove, onLabelChange }: {
  row: UnifiedTableRow
  timeHeaders: string[]
  values: Record<string, string>
  onRemove: () => void
  onLabelChange: (label: string) => void
}) {
  const theme = SERVICE_TYPE_INFO[row.serviceType]
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(row.label)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`group transition ${isDragging ? 'opacity-40 bg-purple-50' : 'hover:bg-gray-50'}`}
    >
      {/* ハンドル */}
      <td className="w-6 pl-2" {...attributes} {...listeners}>
        <span className="text-gray-300 cursor-grab active:cursor-grabbing select-none text-sm">⠿</span>
      </td>

      {/* サービスバッジ */}
      <td className="px-2 py-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${theme?.badgeClass ?? 'bg-gray-100 text-gray-600'}`}>
          {theme?.icon} {theme?.abbr ?? row.serviceType}
        </span>
      </td>

      {/* 行ラベル（クリックで編集） */}
      <td className="px-2 py-2 min-w-[140px]">
        {editing ? (
          <input
            autoFocus
            type="text"
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            onBlur={() => { onLabelChange(labelDraft); setEditing(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { onLabelChange(labelDraft); setEditing(false) } if (e.key === 'Escape') { setLabelDraft(row.label); setEditing(false) } }}
            className="w-full text-xs border border-purple-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-left text-gray-700 hover:text-purple-600 hover:underline"
            title="クリックでラベル編集"
          >
            {row.label}
          </button>
        )}
      </td>

      {/* データセル（プレビュー） */}
      {timeHeaders.map(h => (
        <td key={h} className="px-3 py-2 text-xs text-center text-gray-400 whitespace-nowrap">
          {values[h] ?? '—'}
        </td>
      ))}

      {/* 削除ボタン */}
      <td className="pr-2">
        <button
          onClick={onRemove}
          className="w-5 h-5 rounded-full bg-red-100 text-red-400 hover:bg-red-200 hover:text-red-600 items-center justify-center text-xs hidden group-hover:flex transition"
          title="行を削除"
        >
          ×
        </button>
      </td>
    </tr>
  )
}

// ── 右パネル全体がドロップ対象 ───────────────────────────────────────────────

function RightDropPanel({ children, isCardDragging }: { children: React.ReactNode; isCardDragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'right-panel' })
  return (
    <main
      ref={setNodeRef}
      className={`flex-1 overflow-auto p-4 transition-colors ${isCardDragging ? isOver ? 'bg-purple-50/60' : 'bg-purple-50/20' : ''}`}
    >
      {children}
    </main>
  )
}

// ── メインページ ─────────────────────────────────────────────────────────────

export default function UnifiedTemplateEditPage({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>
}) {
  const { projectId, templateId } = use(params)
  const router = useRouter()
  const dndId = useId()

  // ── データ取得 ────────────────────────────────────────────────
  const { data: configData } = useSWR<{ success: boolean; data: { services: ConfigService[] } }>(
    `/api/projects/${projectId}/unified-summary/config`,
    fetcher,
  )
  const { data: projectData } = useSWR<{ success: boolean; data: { project_name: string } }>(
    `/api/projects/${projectId}`,
    fetcher,
  )

  const services = configData?.data?.services ?? []
  const projectName = projectData?.data?.project_name ?? ''

  // ── テンプレート状態 ──────────────────────────────────────────
  const [name, setName]           = useState('')
  const [timeUnit, setTimeUnit]   = useState<TimeUnit>('day')
  const [count, setCount]         = useState(14)
  const [rangeStart, setRangeStart] = useState<string>('')
  const [rangeEnd, setRangeEnd]   = useState<string>('')
  const [rows, setRows]           = useState<UnifiedTableRow[]>([])
  const [isDirty, setIsDirty]     = useState(false)
  const [isSaving, setIsSaving]   = useState(false)
  const [saveError, setSaveError] = useState('')
  const [loaded, setLoaded]       = useState(false)

  // ── カスタム指標ライブラリ（サービスごとに取得） ──────────────
  interface LibraryMetric { id: string; service_id: string; name: string; formula: Record<string, unknown> }
  const [customMetricsByService, setCustomMetricsByService] = useState<Record<string, LibraryMetric[]>>({})

  useEffect(() => {
    if (services.length === 0) return
    Promise.all(
      services.map(svc =>
        fetch(`/api/services/${svc.id}/custom-metrics`)
          .then(r => r.json())
          .then(j => ({ serviceId: svc.id, data: (j.data ?? []) as LibraryMetric[] }))
          .catch(() => ({ serviceId: svc.id, data: [] as LibraryMetric[] }))
      )
    ).then(results => {
      const map: Record<string, LibraryMetric[]> = {}
      for (const { serviceId, data } of results) map[serviceId] = data
      setCustomMetricsByService(map)
    })
  }, [services])

  // ── カタログ（サービス → メトリクス） ─────────────────────────
  // configData の availableMetrics を優先。無ければ getMetricCatalog を使用
  const serviceCatalogs = useMemo(() => services.map(svc => ({
    serviceId:   svc.id,
    serviceType: svc.serviceType,
    serviceName: svc.name,
    metrics:     svc.availableMetrics.length > 0
      ? svc.availableMetrics
      : getMetricCatalog(svc.serviceType),
    customMetrics: (customMetricsByService[svc.id] ?? []).map(m => ({
      id:       m.id,
      label:    m.name,
      category: 'カスタム指標',
      fieldRef: m.id,
    })),
  })), [services, customMetricsByService])

  // カテゴリ別グルーピング（サービス内）
  const catalogByService = useMemo(() => serviceCatalogs.map(svc => {
    const byCategory: Record<string, typeof svc.metrics> = {}
    for (const m of svc.metrics) {
      ;(byCategory[m.category] ??= []).push(m)
    }
    return { ...svc, byCategory }
  }), [serviceCatalogs])

  // ── テンプレート初期ロード ─────────────────────────────────────
  useEffect(() => {
    if (loaded) return
    getTemplate(projectId, templateId)
      .then((tmpl: ProjectSummaryTemplate) => {
        setName(tmpl.name)
        setTimeUnit(tmpl.timeUnit)
        setCount(tmpl.count)
        setRangeStart(tmpl.rangeStart ?? '')
        setRangeEnd(tmpl.rangeEnd ?? '')
        setRows(tmpl.rows)
        setLoaded(true)
      })
      .catch(() => router.replace(`/projects/${projectId}/unified-summary`))
  }, [loaded, projectId, templateId, router])

  // ── 時間軸ヘッダ ───────────────────────────────────────────────
  const timeHeaders = generateTimeHeaders(timeUnit, count, rangeStart || null, rangeEnd || null)

  // ── DnD センサー ───────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [activeCard, setActiveCard] = useState<null | { card: { id: string; label: string }; serviceType: string }>(null)

  const handleDragStart = useCallback((e: DragStartEvent) => {
    if (e.active.data.current?.card) {
      setActiveCard({ card: e.active.data.current.card, serviceType: e.active.data.current.serviceType })
    }
  }, [])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveCard(null)
    const { active, over } = e
    if (!over) return

    const isCardDrag = String(active.id).startsWith('card::')

    if (isCardDrag) {
      // カタログカード → 右パネル上ならどこにドロップしても追加
      const { card, serviceType } = active.data.current as { card: { id: string; label: string; category: string; fieldRef: string }; serviceType: string }
      const svc = services.find(s => s.serviceType === serviceType)
      if (!svc) return
      if (rows.some(r => r.serviceId === svc.id && r.metricRef === card.id)) return
      const newRow: UnifiedTableRow = {
        id:          crypto.randomUUID(),
        serviceId:   svc.id,
        serviceType: svc.serviceType,
        metricRef:   card.id,
        label:       card.label,
      }
      setRows(prev => [...prev, newRow])
      setIsDirty(true)
    } else {
      // テーブル行の並び替え（over が別の行のときのみ）
      const targetRowExists = rows.find(r => r.id === over.id)
      if (active.id !== over.id && targetRowExists) {
        setRows(prev => {
          const oldIndex = prev.findIndex(r => r.id === active.id)
          const newIndex = prev.findIndex(r => r.id === over.id)
          if (oldIndex < 0 || newIndex < 0) return prev
          return arrayMove(prev, oldIndex, newIndex)
        })
        setIsDirty(true)
      }
    }
  }, [rows, services])

  // ── 保存 ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (isSaving) return
    setIsSaving(true)
    setSaveError('')
    try {
      await updateTemplate(projectId, templateId, {
        name,
        timeUnit,
        count,
        rangeStart: rangeStart || null,
        rangeEnd:   rangeEnd   || null,
        rows,
      })
      setIsDirty(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, projectId, templateId, name, timeUnit, count, rangeStart, rangeEnd, rows])

  // ── 削除 ──────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const handleDelete = useCallback(async () => {
    await deleteTemplate(projectId, templateId)
    router.replace(`/projects/${projectId}/unified-summary`)
  }, [projectId, templateId, router])

  // ── サービス別アコーディオン開閉状態 ──────────────────────────
  const [openServices, setOpenServices] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState('')

  const toggleService = (serviceId: string) => {
    setOpenServices(prev => ({ ...prev, [serviceId]: !prev[serviceId] }))
  }

  // 追加済み判定
  const addedKeys = new Set(rows.map(r => `${r.serviceId}::${r.metricRef}`))

  // ── 時間単位変更 ───────────────────────────────────────────────
  const handleTimeUnitChange = (u: TimeUnit) => {
    setTimeUnit(u)
    if (u !== 'custom_range') setCount(TIME_UNIT_DEFAULT_COUNT[u])
    setIsDirty(true)
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-sm text-gray-500">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* ── ヘッダー ────────────────────────────────────────────── */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <Link
          href={`/projects/${projectId}/unified-summary`}
          className="text-gray-400 hover:text-gray-600 transition"
        >
          ←
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setIsDirty(true) }}
              className="text-sm font-semibold text-gray-800 bg-transparent border-0 border-b-2 border-transparent hover:border-gray-200 focus:border-purple-400 focus:outline-none px-0 py-0.5 w-64"
              placeholder="テンプレート名"
            />
            {isDirty && <span className="text-[10px] text-amber-500 font-medium">未保存</span>}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{projectName} / 横断サマリー</div>
        </div>

        {/* 時間単位コントロール */}
        <div className="flex items-center gap-2">
          <select
            value={timeUnit}
            onChange={e => handleTimeUnitChange(e.target.value as TimeUnit)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
          >
            {(Object.keys(TIME_UNIT_LABELS) as TimeUnit[])
              .filter(u => u !== 'hour')
              .map(u => (
                <option key={u} value={u}>{TIME_UNIT_LABELS[u]}</option>
              ))}
          </select>

          {timeUnit === 'custom_range' ? (
            <div className="flex items-center gap-1 text-xs">
              <input
                type="date"
                value={rangeStart}
                onChange={e => { setRangeStart(e.target.value); setIsDirty(true) }}
                className="border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <span className="text-gray-400">〜</span>
              <input
                type="date"
                value={rangeEnd}
                onChange={e => { setRangeEnd(e.target.value); setIsDirty(true) }}
                className="border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-500">直近</span>
              <input
                type="number"
                min={1}
                max={90}
                value={count}
                onChange={e => { setCount(Number(e.target.value)); setIsDirty(true) }}
                className="w-14 border border-gray-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <span className="text-gray-500">
                {timeUnit === 'day' ? '日' : timeUnit === 'week' ? '週' : 'ヶ月'}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {saveError && <span className="text-xs text-red-500">{saveError}</span>}
          <Link
            href={`/projects/${projectId}/unified-summary/templates/${templateId}/view`}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            閲覧
          </Link>
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-200 disabled:text-gray-400 rounded-lg transition"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg transition"
          >
            削除
          </button>
        </div>
      </header>

      {/* ── 本体: 左パネル ＋ 右テーブル ─────────────────────────── */}
      <DndContext
        id={dndId}
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 overflow-hidden">
          {/* 左パネル: 指標カタログ */}
          <aside className="w-64 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-100">
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-2">指標カタログ</p>
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="指標を検索..."
                className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {catalogByService.map(svc => {
                const theme = SERVICE_TYPE_INFO[svc.serviceType]
                const isOpen = openServices[svc.serviceId] !== false // デフォルト開く
                const filteredCategories = Object.entries(svc.byCategory)
                  .map(([cat, cards]) => ({
                    cat,
                    cards: searchQuery
                      ? cards.filter(c => c.label.includes(searchQuery) || c.fieldRef.includes(searchQuery))
                      : cards,
                  }))
                  .filter(({ cards }) => cards.length > 0)

                if (filteredCategories.length === 0) return null

                return (
                  <div key={svc.serviceId} className="rounded-xl overflow-hidden border border-gray-100">
                    {/* サービスヘッダ */}
                    <button
                      onClick={() => toggleService(svc.serviceId)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold ${theme?.color ?? 'text-gray-600'} ${theme?.bgColor ?? 'bg-gray-50'} border-b border-gray-100 hover:brightness-95 transition`}
                    >
                      <span>{theme?.icon}</span>
                      <span className="flex-1 text-left">{svc.serviceName}</span>
                      <span className="text-gray-400">{isOpen ? '▾' : '▸'}</span>
                    </button>

                    {/* カテゴリ別カード */}
                    {isOpen && (
                      <div className="p-2 space-y-2">
                        {filteredCategories.map(({ cat, cards }) => (
                          <div key={cat}>
                            <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-1">{cat}</div>
                            <div className="space-y-1">
                              {cards.map(card => (
                                <DraggableCard
                                  key={card.id}
                                  card={card}
                                  serviceType={svc.serviceType}
                                  alreadyAdded={addedKeys.has(`${svc.serviceId}::${card.id}`)}
                                />
                              ))}
                            </div>
                          </div>
                        ))}

                        {/* カスタム指標セクション */}
                        {svc.customMetrics.length > 0 && (
                          <div>
                            <div className="text-[9px] font-semibold text-amber-500 uppercase tracking-wider px-1 mb-1 flex items-center gap-1">
                              ✦ カスタム指標
                            </div>
                            <div className="space-y-1">
                              {svc.customMetrics
                                .filter(m => !searchQuery || m.label.includes(searchQuery))
                                .map(card => (
                                  <DraggableCard
                                    key={card.id}
                                    card={card}
                                    serviceType={svc.serviceType}
                                    alreadyAdded={addedKeys.has(`${svc.serviceId}::${card.id}`)}
                                    isCustom
                                  />
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {catalogByService.length === 0 && (
                <div className="text-center py-8 text-xs text-gray-400">
                  サービスが見つかりません
                </div>
              )}
            </div>
          </aside>

          {/* 右エリア: テーブル（全体がドロップ対象） */}
          <RightDropPanel isCardDragging={activeCard !== null}>
            <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
              {rows.length === 0 ? (
                /* 空の状態 */
                <div className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed h-64 text-sm gap-2 transition
                  ${activeCard ? 'border-purple-400 bg-purple-50 text-purple-500' : 'border-gray-200 text-gray-400'}`}>
                  <span className="text-3xl">{activeCard ? '↓' : '←'}</span>
                  <p>{activeCard ? 'ここにドロップして追加' : '左の指標カードをドラッグしてここに追加'}</p>
                </div>
              ) : (
                <div>
                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="w-6" />
                          <th className="px-2 py-2 text-left text-gray-500 font-medium whitespace-nowrap w-20">サービス</th>
                          <th className="px-2 py-2 text-left text-gray-700 font-semibold min-w-[140px]">指標</th>
                          {timeHeaders.map(h => (
                            <th key={h} className="px-3 py-2 text-center text-gray-500 font-medium whitespace-nowrap">{h}</th>
                          ))}
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.map(row => (
                          <SortableRow
                            key={row.id}
                            row={row}
                            timeHeaders={timeHeaders}
                            values={{}}
                            onRemove={() => { setRows(prev => prev.filter(r => r.id !== row.id)); setIsDirty(true) }}
                            onLabelChange={label => {
                              setRows(prev => prev.map(r => r.id === row.id ? { ...r, label } : r))
                              setIsDirty(true)
                            }}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* テーブル下ドロップバナー：ドラッグ中に常時表示 */}
                  <div className={`mt-2 rounded-xl border-2 border-dashed py-4 text-center text-xs transition
                    ${activeCard ? 'border-purple-400 bg-purple-50 text-purple-500' : 'border-gray-100 text-gray-300'}`}>
                    {activeCard ? '↓ ここにドロップして末尾に追加' : '+ 指標カードをドラッグしてここに追加'}
                  </div>

                  <p className="mt-2 text-[10px] text-gray-400 text-center">
                    ⠿ 行をドラッグして並び替え ／ ラベルをクリックして編集
                  </p>
                </div>
              )}
            </SortableContext>
          </RightDropPanel>
        </div>

        {/* ドラッグオーバーレイ */}
        <DragOverlay>
          {activeCard && (
            <div className="px-3 py-2 rounded-lg border border-purple-400 bg-purple-50 text-xs font-medium text-purple-700 shadow-lg">
              {SERVICE_TYPE_INFO[activeCard.serviceType]?.icon} {activeCard.card.label}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* 削除確認モーダル */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-80 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-2">テンプレートを削除しますか？</h3>
            <p className="text-sm text-gray-500 mb-6">「{name}」を削除します。この操作は取り消せません。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition"
              >
                キャンセル
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl transition"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
