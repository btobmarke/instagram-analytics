'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 型 ──────────────────────────────────────────────────────────────────────

interface KpiNode {
  id:         string
  projectId:  string
  parentId:   string | null
  sortOrder:  number
  label:      string
  nodeType:   'folder' | 'leaf'
  metricRef:  string | null
  serviceId:  string | null
}

interface Preset {
  id:                string
  name:              string
  targetMetricRef:   string
  featureMetricRefs: string[]
}

interface MetricOption {
  colKey:    string   // "{serviceId}::{metricRef}"
  label:     string
  service:   string
}

interface AnalysisResult {
  wideTable:   Record<string, number | null>[]
  columns:     string[]
  correlation: { col1: string; col2: string; r: number; n: number }[]
  regression?: {
    target:       string
    features:     string[]
    coefficients: { label: string; coef: number }[]
    intercept:    number
    r2:           number
    n:            number
  }
  warnings: string[]
}

interface ConfigService {
  id:               string
  name:             string
  serviceType:      string
  availableMetrics: { id: string; label: string; category: string }[]
}

// ── 相関色 ───────────────────────────────────────────────────────────────────

function corrColor(r: number): string {
  const abs = Math.abs(r)
  if (abs >= 0.7) return r > 0 ? 'bg-blue-200 text-blue-900' : 'bg-red-200 text-red-900'
  if (abs >= 0.4) return r > 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
  return 'bg-gray-50 text-gray-500'
}

// ── DnD ソータブルノード行 ────────────────────────────────────────────────────

function SortableNodeRow({
  node,
  depth,
  metricOptions,
  onUpdate,
  onDelete,
  onAddChild,
}: {
  node:          KpiNode
  depth:         number
  metricOptions: MetricOption[]
  onUpdate:      (id: string, updates: Partial<KpiNode>) => void
  onDelete:      (id: string) => void
  onAddChild:    (parentId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id })
  const [editing, setEditing] = useState(false)
  const [labelVal, setLabelVal] = useState(node.label)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const commitLabel = () => {
    if (labelVal.trim() && labelVal !== node.label) {
      onUpdate(node.id, { label: labelVal.trim() })
    }
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg group hover:bg-gray-50 text-sm
        ${isDragging ? 'shadow-lg bg-white z-10' : ''}`}
    >
      {/* インデント */}
      <div style={{ width: depth * 16 }} className="flex-shrink-0" />

      {/* ドラッグハンドル */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-gray-300 hover:text-gray-500 flex-shrink-0 touch-none"
      >
        ⠿
      </button>

      {/* アイコン */}
      <span className="flex-shrink-0 text-base">
        {node.nodeType === 'folder' ? '📁' : '📌'}
      </span>

      {/* ラベル */}
      {editing ? (
        <input
          autoFocus
          value={labelVal}
          onChange={e => setLabelVal(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') { setLabelVal(node.label); setEditing(false) } }}
          className="flex-1 min-w-0 border-b border-purple-400 bg-transparent text-sm outline-none px-0.5"
        />
      ) : (
        <button
          className="flex-1 min-w-0 text-left text-gray-800 truncate hover:text-purple-700"
          onDoubleClick={() => setEditing(true)}
          title="ダブルクリックで編集"
        >
          {node.label}
        </button>
      )}

      {/* leaf: 指標選択 */}
      {node.nodeType === 'leaf' && (
        <select
          value={node.metricRef ? `${node.serviceId}::${node.metricRef}` : ''}
          onChange={e => {
            const v = e.target.value
            if (!v) return
            const [svcId, ...rest] = v.split('::')
            onUpdate(node.id, { serviceId: svcId, metricRef: rest.join('::') })
          }}
          className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white max-w-[140px] text-gray-600"
        >
          <option value="">指標未設定</option>
          {metricOptions.map(m => (
            <option key={m.colKey} value={m.colKey}>
              {m.service}: {m.label}
            </option>
          ))}
        </select>
      )}

      {/* 操作ボタン（hover 時のみ表示） */}
      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
        {node.nodeType === 'folder' && (
          <button
            onClick={() => onAddChild(node.id)}
            className="text-xs text-gray-400 hover:text-purple-600 px-1"
            title="子ノードを追加"
          >＋</button>
        )}
        <button
          onClick={() => onDelete(node.id)}
          className="text-xs text-gray-300 hover:text-red-500 px-1"
          title="削除"
        >✕</button>
      </div>
    </div>
  )
}

// ── KPIツリーエディタ ─────────────────────────────────────────────────────────

function KpiTreeEditor({
  projectId,
  metricOptions,
}: {
  projectId:     string
  metricOptions: MetricOption[]
}) {
  const { data: resp, mutate } = useSWR<{ success: boolean; data: KpiNode[] }>(
    `/api/projects/${projectId}/kpi-tree/nodes`,
    fetcher,
  )
  const [nodes, setNodes] = useState<KpiNode[]>([])

  useEffect(() => {
    if (resp?.data) {
      // Supabase returns snake_case — map to camelCase KpiNode
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setNodes(resp.data.map((n: any) => ({
        id:        n.id        as string,
        projectId: n.project_id as string,
        parentId:  n.parent_id  as string | null,
        sortOrder: n.sort_order as number,
        label:     n.label      as string,
        nodeType:  n.node_type  as 'folder' | 'leaf',
        metricRef: n.metric_ref as string | null,
        serviceId: n.service_id as string | null,
      })))
    }
  }, [resp])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // フラットリストを DnD 用に並べる（parent → children 順）
  const flatOrdered = useMemo(() => {
    const roots = nodes.filter(n => !n.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
    const result: { node: KpiNode; depth: number }[] = []
    const walk = (nodes: KpiNode[], depth: number) => {
      for (const n of nodes) {
        result.push({ node: n, depth })
        const children = nodes.filter(c => c.parentId === n.id).sort((a, b) => a.sortOrder - b.sortOrder)
        walk(children, depth + 1)
      }
    }
    walk(roots, 0)
    // 全ノードを深さ優先で追加
    const allResult: { node: KpiNode; depth: number }[] = []
    const walkAll = (parentId: string | null, depth: number) => {
      const children = nodes
        .filter(n => n.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      for (const n of children) {
        allResult.push({ node: n, depth })
        walkAll(n.id, depth + 1)
      }
    }
    walkAll(null, 0)
    return allResult
  }, [nodes])

  const addNode = async (nodeType: 'folder' | 'leaf', parentId: string | null = null) => {
    const label = nodeType === 'folder' ? '新規フォルダ' : '新規指標'
    const maxOrder = nodes.filter(n => n.parentId === parentId).reduce((m, n) => Math.max(m, n.sortOrder), -1)
    const res = await fetch(`/api/projects/${projectId}/kpi-tree/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, label, nodeType, sortOrder: maxOrder + 1 }),
    })
    if (res.ok) mutate()
  }

  const updateNode = async (id: string, updates: Partial<KpiNode>) => {
    const apiUpdates: Record<string, unknown> = {}
    if (updates.label     !== undefined) apiUpdates.label     = updates.label
    if (updates.metricRef !== undefined) apiUpdates.metricRef = updates.metricRef
    if (updates.serviceId !== undefined) apiUpdates.serviceId = updates.serviceId
    if (updates.parentId  !== undefined) apiUpdates.parentId  = updates.parentId
    if (updates.sortOrder !== undefined) apiUpdates.sortOrder = updates.sortOrder

    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n))
    await fetch(`/api/projects/${projectId}/kpi-tree/nodes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiUpdates),
    })
    mutate()
  }

  const deleteNode = async (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id && n.parentId !== id))
    await fetch(`/api/projects/${projectId}/kpi-tree/nodes/${id}`, { method: 'DELETE' })
    mutate()
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = flatOrdered.findIndex(({ node }) => node.id === active.id)
    const newIndex = flatOrdered.findIndex(({ node }) => node.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(flatOrdered, oldIndex, newIndex)

    // sort_order を再割り当て（同じ parentId グループ内で）
    const updatedNodes = nodes.map(n => {
      const idx = reordered.findIndex(({ node }) => node.id === n.id)
      return idx >= 0 ? { ...n, sortOrder: idx } : n
    })
    setNodes(updatedNodes)

    // 移動したノードの sort_order を API に反映
    const moved = updatedNodes.find(n => n.id === active.id)!
    await fetch(`/api/projects/${projectId}/kpi-tree/nodes/${moved.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder: moved.sortOrder }),
    })
    mutate()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">📊 KPI ツリー</h3>
        <div className="flex gap-1.5">
          <button
            onClick={() => addNode('folder')}
            className="text-xs px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 transition"
          >
            ＋ フォルダ
          </button>
          <button
            onClick={() => addNode('leaf')}
            className="text-xs px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition"
          >
            ＋ 指標
          </button>
        </div>
      </div>

      <div className="p-2 min-h-[180px]">
        {flatOrdered.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-10">
            「＋ フォルダ」「＋ 指標」ボタンでノードを追加してください
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={flatOrdered.map(({ node }) => node.id)}
              strategy={verticalListSortingStrategy}
            >
              {flatOrdered.map(({ node, depth }) => (
                <SortableNodeRow
                  key={node.id}
                  node={node}
                  depth={depth}
                  metricOptions={metricOptions}
                  onUpdate={updateNode}
                  onDelete={deleteNode}
                  onAddChild={(pid) => addNode('leaf', pid)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
        ドラッグで並び替え ／ ダブルクリックでラベル編集
      </div>
    </div>
  )
}

// ── プリセット管理 ────────────────────────────────────────────────────────────

function PresetManager({
  projectId,
  metricOptions,
  selectedPresetId,
  onSelect,
}: {
  projectId:        string
  metricOptions:    MetricOption[]
  selectedPresetId: string | null
  onSelect:         (preset: Preset | null) => void
}) {
  const { data: resp, mutate } = useSWR<{ success: boolean; data: Preset[] }>(
    `/api/projects/${projectId}/analysis-presets`,
    fetcher,
  )
  const presets = resp?.data ?? []

  const [showForm, setShowForm]               = useState(false)
  const [name, setName]                       = useState('')
  const [targetRef, setTargetRef]             = useState('')
  const [featureRefs, setFeatureRefs]         = useState<string[]>([])
  const [saving, setSaving]                   = useState(false)

  const toggleFeature = (ref: string) => {
    setFeatureRefs(prev =>
      prev.includes(ref) ? prev.filter(r => r !== ref) : [...prev, ref]
    )
  }

  const savePreset = async () => {
    if (!name.trim() || !targetRef || featureRefs.length === 0) return
    setSaving(true)
    await fetch(`/api/projects/${projectId}/analysis-presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), targetMetricRef: targetRef, featureMetricRefs: featureRefs }),
    })
    setSaving(false)
    setShowForm(false)
    setName(''); setTargetRef(''); setFeatureRefs([])
    mutate()
  }

  const deletePreset = async (id: string) => {
    if (selectedPresetId === id) onSelect(null)
    await fetch(`/api/projects/${projectId}/analysis-presets/${id}`, { method: 'DELETE' })
    mutate()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">🎯 プリセット</h3>
        <button
          onClick={() => setShowForm(v => !v)}
          className="text-xs px-2.5 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition"
        >
          ＋ 新規
        </button>
      </div>

      {/* プリセット作成フォーム */}
      {showForm && (
        <div className="px-4 py-3 border-b border-gray-100 bg-green-50/50 space-y-3">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="プリセット名（例: 新規獲得）"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-green-400"
          />
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Y 変数（目的変数）</p>
            <select
              value={targetRef}
              onChange={e => setTargetRef(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
            >
              <option value="">選択してください</option>
              {metricOptions.map(m => (
                <option key={m.colKey} value={m.colKey}>{m.service}: {m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">X 変数（説明変数・複数選択可）</p>
            <div className="max-h-36 overflow-y-auto space-y-0.5 border border-gray-200 rounded-lg p-2 bg-white">
              {metricOptions.map(m => (
                <label key={m.colKey} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-purple-700">
                  <input
                    type="checkbox"
                    checked={featureRefs.includes(m.colKey)}
                    onChange={() => toggleFeature(m.colKey)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-purple-600"
                  />
                  {m.service}: {m.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={savePreset}
              disabled={saving || !name.trim() || !targetRef || featureRefs.length === 0}
              className="flex-1 text-xs py-1.5 rounded-lg bg-green-600 text-white font-medium disabled:opacity-50 hover:bg-green-700 transition"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* プリセット一覧 */}
      <div className="p-2 min-h-[80px]">
        {presets.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">プリセットなし</p>
        ) : (
          presets.map(p => (
            <div
              key={p.id}
              onClick={() => onSelect(selectedPresetId === p.id ? null : p)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition group
                ${selectedPresetId === p.id ? 'bg-purple-50 text-purple-800' : 'hover:bg-gray-50 text-gray-700'}`}
            >
              <span className="flex-1 font-medium truncate">{p.name}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">X:{p.featureMetricRefs.length}</span>
              <button
                onClick={e => { e.stopPropagation(); deletePreset(p.id) }}
                className="hidden group-hover:block text-xs text-gray-300 hover:text-red-500"
              >✕</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── 相関行列 ──────────────────────────────────────────────────────────────────

function CorrelationMatrix({
  correlation,
  columns,
  colLabel,
}: {
  correlation: { col1: string; col2: string; r: number; n: number }[]
  columns:     string[]
  colLabel:    (col: string) => string
}) {
  const getR = (a: string, b: string): number | null => {
    const found = correlation.find(
      c => (c.col1 === a && c.col2 === b) || (c.col1 === b && c.col2 === a)
    )
    return found?.r ?? null
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-left text-gray-500 font-medium min-w-[100px]"></th>
            {columns.map(col => (
              <th
                key={col}
                className="px-2 py-1.5 text-center text-gray-600 font-medium whitespace-nowrap max-w-[80px]"
                title={colLabel(col)}
              >
                <span className="block truncate max-w-[72px]">{colLabel(col)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map(rowCol => (
            <tr key={rowCol} className="border-t border-gray-100">
              <td
                className="px-2 py-1.5 text-gray-600 font-medium whitespace-nowrap max-w-[120px]"
                title={colLabel(rowCol)}
              >
                <span className="block truncate max-w-[112px]">{colLabel(rowCol)}</span>
              </td>
              {columns.map(colCol => {
                const r = getR(rowCol, colCol)
                const isSelf = rowCol === colCol
                return (
                  <td
                    key={colCol}
                    className={`px-2 py-1.5 text-center font-mono font-semibold rounded ${
                      isSelf ? 'bg-gray-200 text-gray-500' : r !== null ? corrColor(r) : 'text-gray-300'
                    }`}
                    title={r !== null ? `r = ${r}` : undefined}
                  >
                    {isSelf ? '—' : r !== null ? r.toFixed(2) : 'N/A'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-400 mt-2">
        ※ 相関関係は因果関係を示すものではありません。
      </p>
    </div>
  )
}

// ── 回帰結果 ──────────────────────────────────────────────────────────────────

function RegressionResult({
  regression,
  colLabel,
}: {
  regression: NonNullable<AnalysisResult['regression']>
  colLabel:   (col: string) => string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm">
        <div className="bg-indigo-50 rounded-lg px-4 py-2 text-center">
          <p className="text-xs text-indigo-600">R²</p>
          <p className="text-xl font-bold text-indigo-800">{regression.r2.toFixed(3)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-2 text-center">
          <p className="text-xs text-gray-500">観測数</p>
          <p className="text-xl font-bold text-gray-700">{regression.n}</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Y = {colLabel(regression.target)}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-3 py-1.5 font-medium text-gray-500">変数</th>
              <th className="text-right px-3 py-1.5 font-medium text-gray-500">係数</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="px-3 py-1.5 text-gray-600">定数項</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-700">{regression.intercept.toFixed(4)}</td>
            </tr>
            {regression.coefficients.map(c => (
              <tr key={c.label}>
                <td className="px-3 py-1.5 text-gray-700">{colLabel(c.label)}</td>
                <td className={`px-3 py-1.5 text-right font-mono font-semibold ${
                  c.coef > 0 ? 'text-blue-700' : c.coef < 0 ? 'text-red-600' : 'text-gray-500'
                }`}>
                  {c.coef > 0 ? '+' : ''}{c.coef.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400">
        ※ 線形回帰（OLS）。係数・R² は統計的有意性を保証するものではありません。
      </p>
    </div>
  )
}

// ── メイン: AnalysisTab ───────────────────────────────────────────────────────

export function AnalysisTab({
  projectId,
  configServices,
}: {
  projectId:      string
  configServices: ConfigService[]
}) {
  // 指標オプション（colKey = "serviceId::metricRef"）
  const metricOptions: MetricOption[] = useMemo(() => {
    const svcMetrics = configServices.flatMap(svc =>
      svc.availableMetrics.map(m => ({
        colKey:  `${svc.id}::${m.id}`,
        label:   m.label,
        service: svc.name,
      }))
    )

    // 外生変数（project_external_daily）も分析の列候補として追加
    const externalMetrics: MetricOption[] = [
      { colKey: 'external.is_holiday',       label: '祝日フラグ（1/0）', service: '外生' },
      { colKey: 'external.temperature_max',  label: '最高気温',           service: '外生' },
      { colKey: 'external.temperature_min',  label: '最低気温',           service: '外生' },
      { colKey: 'external.precipitation_mm', label: '降水量(mm)',         service: '外生' },
      { colKey: 'external.weather_code',     label: '天気コード',         service: '外生' },
    ]

    return [...svcMetrics, ...externalMetrics]
  }, [configServices])

  const colLabel = useCallback((col: string) => {
    const found = metricOptions.find(m => m.colKey === col)
    return found ? `${found.service}:${found.label}` : col
  }, [metricOptions])

  // プリセット選択
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)

  // 分析設定
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(thirtyDaysAgo)
  const [endDate, setEndDate]     = useState(today)
  const [timeUnit, setTimeUnit]   = useState<'day' | 'week' | 'month'>('day')

  // 分析実行
  const [result, setResult]     = useState<AnalysisResult | null>(null)
  const [running, setRunning]   = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const canRun = selectedPreset &&
    selectedPreset.targetMetricRef &&
    selectedPreset.featureMetricRefs.length > 0

  const runAnalysis = async () => {
    if (!canRun) return
    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetMetricRef:   selectedPreset.targetMetricRef,
          featureMetricRefs: selectedPreset.featureMetricRefs,
          startDate,
          endDate,
          timeUnit,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'エラーが発生しました')
      setResult(json.data)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* 左パネル: ツリー + プリセット */}
      <div className="lg:col-span-1 space-y-4">
        <KpiTreeEditor projectId={projectId} metricOptions={metricOptions} />
        <PresetManager
          projectId={projectId}
          metricOptions={metricOptions}
          selectedPresetId={selectedPreset?.id ?? null}
          onSelect={setSelectedPreset}
        />
      </div>

      {/* 右パネル: 分析設定 + 結果 */}
      <div className="lg:col-span-2 space-y-4">
        {/* 分析設定 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">⚙️ 分析設定</h3>

          {/* プリセット確認 */}
          {selectedPreset ? (
            <div className="bg-purple-50 rounded-lg p-3 mb-3 text-xs space-y-1">
              <p className="font-semibold text-purple-800">プリセット: {selectedPreset.name}</p>
              <p className="text-purple-700">Y: {colLabel(selectedPreset.targetMetricRef)}</p>
              <p className="text-purple-600">X: {selectedPreset.featureMetricRefs.map(colLabel).join('、')}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 mb-3">左パネルからプリセットを選択してください</p>
          )}

          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">開始日</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">終了日</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">粒度</label>
              <select
                value={timeUnit}
                onChange={e => setTimeUnit(e.target.value as 'day' | 'week' | 'month')}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-purple-400"
              >
                <option value="day">日次</option>
                <option value="week">週次</option>
                <option value="month">月次</option>
              </select>
            </div>
            <button
              onClick={runAnalysis}
              disabled={!canRun || running}
              className="px-5 py-1.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transition disabled:opacity-50"
            >
              {running ? '計算中...' : '▶ 分析実行'}
            </button>
          </div>
        </div>

        {/* エラー */}
        {runError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {runError}
          </div>
        )}

        {/* 警告 */}
        {result?.warnings && result.warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
            ))}
          </div>
        )}

        {/* 相関行列 */}
        {result && result.correlation.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">📐 相関行列</h3>
              <p className="text-xs text-gray-400 mt-0.5">{result.wideTable.length} 観測</p>
            </div>
            <div className="p-4">
              <CorrelationMatrix
                correlation={result.correlation}
                columns={result.columns}
                colLabel={colLabel}
              />
            </div>
          </div>
        )}

        {/* 回帰結果 */}
        {result?.regression && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">📈 線形回帰（OLS）</h3>
            </div>
            <div className="p-4">
              <RegressionResult regression={result.regression} colLabel={colLabel} />
            </div>
          </div>
        )}

        {/* データなし */}
        {result && result.wideTable.length === 0 && (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
            <p className="text-sm text-gray-400">指定期間のキャッシュデータが見つかりませんでした。</p>
            <p className="text-xs text-gray-400 mt-1">バッチを実行してデータを蓄積してください。</p>
          </div>
        )}
      </div>
    </div>
  )
}
