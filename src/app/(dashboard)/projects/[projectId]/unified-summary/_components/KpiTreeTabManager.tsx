'use client'

/**
 * KpiTreeTabManager
 *
 * 複数の KPI ツリーをタブで管理するコンポーネント。
 * ツリーの作成・名前変更・削除と、選択中ツリーの編集（KpiTreeEditor 呼び出し）を担当する。
 */

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { CustomMetricManager } from './CustomMetricManager'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 型 ──────────────────────────────────────────────────────────────────────

interface KpiTree {
  id:        string
  name:      string
  createdAt: string
}

interface KpiTreeTemplate {
  id: string
  template_key: string
  name: string
  description: string | null
  scope: 'service_type' | 'cross_service'
  target_industry: string | null
  version_no: number
}

interface KpiNode {
  id:        string
  projectId: string
  parentId:  string | null
  sortOrder: number
  label:     string
  nodeType:  'folder' | 'leaf'
  metricRef: string | null
  serviceId: string | null
  kpiTreeId: string
}

interface MetricOption {
  colKey:  string
  label:   string
  service: string
}

interface CustomMetric {
  id:          string
  name:        string
  formula:     string
  unit:        string | null
  description: string | null
}

// ── KPI ノードカード ──────────────────────────────────────────────────────────

function KpiNodeCard({
  node, siblings, hasChildren, collapsed,
  onToggleCollapse, metricOptions, onUpdate, onDelete, onAddChild, onMove,
}: {
  node:             KpiNode
  siblings:         KpiNode[]
  hasChildren:      boolean
  collapsed:        boolean
  onToggleCollapse: () => void
  metricOptions:    MetricOption[]
  onUpdate:         (id: string, updates: Partial<KpiNode>) => void
  onDelete:         (id: string) => void
  onAddChild:       (parentId: string) => void
  onMove:           (id: string, dir: 'up' | 'down') => void
}) {
  const [editing,  setEditing]  = useState(false)
  const [labelVal, setLabelVal] = useState(node.label)
  const myIndex     = siblings.findIndex(s => s.id === node.id)
  const canMoveUp   = myIndex > 0
  const canMoveDown = myIndex < siblings.length - 1
  const isBranch    = hasChildren

  const commitLabel = () => {
    if (labelVal.trim() && labelVal !== node.label) onUpdate(node.id, { label: labelVal.trim() })
    setEditing(false)
  }

  return (
    <div className={`relative group rounded-xl border shadow-sm transition-shadow min-w-[120px] max-w-[200px] hover:shadow-md
      ${isBranch ? 'border-purple-200 bg-purple-50' : 'border-indigo-200 bg-white'}`}>
      <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full ${isBranch ? 'bg-purple-400' : 'bg-indigo-400'}`} />
      <div className="px-3 pl-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {hasChildren ? (
            <button onClick={onToggleCollapse}
              className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-transform duration-150"
              title={collapsed ? '展開' : '折りたたむ'}>
              <svg className={`w-3 h-3 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          ) : <span className="flex-shrink-0 w-4" />}
          <span className="text-sm leading-none flex-shrink-0">{isBranch ? '📊' : '📌'}</span>
          {editing ? (
            <input autoFocus value={labelVal} onChange={e => setLabelVal(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={e => {
                if (e.key === 'Enter') commitLabel()
                if (e.key === 'Escape') { setLabelVal(node.label); setEditing(false) }
              }}
              className="flex-1 text-sm border-b border-purple-400 bg-transparent outline-none min-w-0 w-28" />
          ) : (
            <span
              className={`text-sm font-medium truncate cursor-text select-none ${isBranch ? 'text-purple-900' : 'text-gray-800'}`}
              onDoubleClick={() => { setEditing(true); setLabelVal(node.label) }}
              title={`${node.label}（ダブルクリックで編集）`}>
              {node.label}
            </span>
          )}
        </div>
        <select
          value={node.metricRef ? (node.serviceId ? `${node.serviceId}::${node.metricRef}` : node.metricRef) : ''}
          onChange={e => {
            const v = e.target.value
            if (!v) { onUpdate(node.id, { serviceId: null, metricRef: null }); return }
            if (!v.includes('::')) { onUpdate(node.id, { serviceId: null, metricRef: v }); return }
            const [svcId, ...rest] = v.split('::')
            onUpdate(node.id, { serviceId: svcId, metricRef: rest.join('::') })
          }}
          className={`mt-1.5 w-full text-[10px] border rounded-md px-1.5 py-1 text-gray-600
            ${isBranch ? 'border-purple-100 bg-purple-50/50' : 'border-gray-200 bg-white'}`}>
          <option value="">指標未設定</option>
          {metricOptions.map(m => (
            <option key={m.colKey} value={m.colKey}>{m.service}: {m.label}</option>
          ))}
        </select>
      </div>
      <div className="absolute -top-3 right-1 hidden group-hover:flex items-center bg-white border border-gray-200 rounded-md shadow px-0.5 gap-px z-10">
        {canMoveUp && (
          <button onClick={() => onMove(node.id, 'up')}
            className="w-5 h-5 flex items-center justify-center text-[10px] text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
            title="上へ">↑</button>
        )}
        {canMoveDown && (
          <button onClick={() => onMove(node.id, 'down')}
            className="w-5 h-5 flex items-center justify-center text-[10px] text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
            title="下へ">↓</button>
        )}
        <button onClick={() => onAddChild(node.id)}
          className="w-5 h-5 flex items-center justify-center text-[10px] text-purple-500 hover:text-purple-700 hover:bg-purple-50 rounded"
          title="子ノードを追加">＋</button>
        <button onClick={() => onDelete(node.id)}
          className="w-5 h-5 flex items-center justify-center text-[10px] text-gray-300 hover:text-red-500 hover:bg-red-50 rounded"
          title="削除">✕</button>
      </div>
    </div>
  )
}

// ── KPI ツリーブランチ（再帰） ────────────────────────────────────────────────

function KpiTreeBranch({
  node, allNodes, metricOptions, onUpdate, onDelete, onAddChild, onMove,
}: {
  node:          KpiNode
  allNodes:      KpiNode[]
  metricOptions: MetricOption[]
  onUpdate:      (id: string, updates: Partial<KpiNode>) => void
  onDelete:      (id: string) => void
  onAddChild:    (parentId: string) => void
  onMove:        (id: string, dir: 'up' | 'down') => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const children = allNodes.filter(n => n.parentId === node.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const siblings  = allNodes.filter(n => n.parentId === node.parentId).sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="flex items-center">
      <KpiNodeCard node={node} siblings={siblings} hasChildren={children.length > 0} collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(v => !v)}
        metricOptions={metricOptions} onUpdate={onUpdate} onDelete={onDelete}
        onAddChild={onAddChild} onMove={onMove} />
      {children.length > 0 && !collapsed && (
        <>
          <div className="w-6 h-px bg-gray-300 flex-shrink-0" />
          <div className="flex flex-col">
            {children.map((child, idx) => {
              const isFirst  = idx === 0
              const isLast   = idx === children.length - 1
              const isSingle = children.length === 1
              return (
                <div key={child.id} className="flex items-center py-2">
                  <div className="relative w-5 self-stretch flex-shrink-0">
                    {!isSingle && (
                      <div className={`absolute left-0 w-px bg-gray-300 ${
                        isFirst ? 'top-1/2 bottom-0' : isLast ? 'top-0 h-1/2' : 'top-0 bottom-0'
                      }`} />
                    )}
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-300 -translate-y-px" />
                  </div>
                  <KpiTreeBranch node={child} allNodes={allNodes} metricOptions={metricOptions}
                    onUpdate={onUpdate} onDelete={onDelete} onAddChild={onAddChild} onMove={onMove} />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── KpiTreeEditor（ツリーID対応版）──────────────────────────────────────────────

function KpiTreeEditor({
  projectId, treeId, metricOptions, customMetrics, onPresetsGenerated, onOpenCustomMetrics,
}: {
  projectId:            string
  treeId:               string
  metricOptions:        MetricOption[]
  customMetrics:        CustomMetric[]
  onPresetsGenerated?:  () => void
  onOpenCustomMetrics?: () => void
}) {
  // カスタム指標を MetricOption 形式に変換してマージ
  const allMetricOptions: MetricOption[] = [
    ...metricOptions,
    ...customMetrics.map(m => ({
      colKey:  `custom::${m.id}`,
      label:   m.name + (m.unit ? ` (${m.unit})` : ''),
      service: '🧮 カスタム',
    })),
  ]
  const { data: resp, mutate } = useSWR<{ success: boolean; data: KpiNode[] }>(
    `/api/projects/${projectId}/kpi-tree/nodes?treeId=${treeId}`,
    fetcher,
  )
  const [nodes, setNodes] = useState<KpiNode[]>([])

  useEffect(() => {
    if (resp?.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setNodes(resp.data.map((n: any) => ({
        id:        n.id          as string,
        projectId: n.project_id  as string,
        parentId:  n.parent_id   as string | null,
        sortOrder: n.sort_order  as number,
        label:     n.label       as string,
        nodeType:  n.node_type   as 'folder' | 'leaf',
        metricRef: n.metric_ref  as string | null,
        serviceId: n.service_id  as string | null,
        kpiTreeId: n.kpi_tree_id as string,
      })))
    }
  }, [resp])

  const addNode = async (parentId: string | null = null) => {
    const maxOrder = nodes.filter(n => n.parentId === parentId).reduce((m, n) => Math.max(m, n.sortOrder), -1)
    await fetch(`/api/projects/${projectId}/kpi-tree/nodes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ treeId, parentId, label: '新規ノード', nodeType: 'leaf', sortOrder: maxOrder + 1 }),
    })
    mutate()
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
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(apiUpdates),
    })
    mutate()
  }

  const deleteNode = async (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id && n.parentId !== id))
    await fetch(`/api/projects/${projectId}/kpi-tree/nodes/${id}`, { method: 'DELETE' })
    mutate()
  }

  const moveNode = async (id: string, dir: 'up' | 'down') => {
    const node = nodes.find(n => n.id === id)
    if (!node) return
    const siblings = nodes.filter(n => n.parentId === node.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = siblings.findIndex(n => n.id === id)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) return
    const sibling = siblings[swapIdx]
    setNodes(prev => prev.map(n => {
      if (n.id === id)         return { ...n, sortOrder: sibling.sortOrder }
      if (n.id === sibling.id) return { ...n, sortOrder: node.sortOrder }
      return n
    }))
    await Promise.all([
      fetch(`/api/projects/${projectId}/kpi-tree/nodes/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: sibling.sortOrder }),
      }),
      fetch(`/api/projects/${projectId}/kpi-tree/nodes/${sibling.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: node.sortOrder }),
      }),
    ])
    mutate()
  }

  const [expanded,          setExpanded]          = useState(false)
  const [genPresetsLoading, setGenPresetsLoading] = useState(false)
  const [genPresetsMsg,     setGenPresetsMsg]     = useState<string | null>(null)
  const [aiGenLoading,      setAiGenLoading]      = useState(false)
  const [aiGenGoal,         setAiGenGoal]         = useState('')
  const [aiGenDays,         setAiGenDays]         = useState(30)
  const [aiGenResult,       setAiGenResult]       = useState<{ dataPoints: number; period: { start: string; end: string; days: number } } | null>(null)
  const [aiGenError,        setAiGenError]        = useState<string | null>(null)
  const [showAiModal,       setShowAiModal]       = useState(false)

  const generatePresets = async () => {
    setGenPresetsLoading(true)
    setGenPresetsMsg(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/kpi-tree/generate-presets`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ treeId }),
      })
      const json = await res.json()
      if (json.success) {
        const { created, updated, message } = json.data
        setGenPresetsMsg(message ?? `プリセットを ${created} 件作成、${updated} 件更新しました`)
        onPresetsGenerated?.()
      } else {
        setGenPresetsMsg(`エラー: ${json.error}`)
      }
    } finally {
      setGenPresetsLoading(false)
    }
  }

  const generateAiTree = async (replace: boolean) => {
    setAiGenLoading(true)
    setAiGenError(null)
    setAiGenResult(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/kpi-tree/ai-generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ treeId, goal: aiGenGoal.trim() || undefined, replace, days: aiGenDays }),
      })
      const json = await res.json()
      if (json.success) {
        mutate()
        setAiGenResult({ dataPoints: json.data.dataPoints, period: json.data.period })
        setAiGenGoal('')
      } else {
        setAiGenError(json.error ?? 'エラーが発生しました')
      }
    } catch (e) {
      setAiGenError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiGenLoading(false)
    }
  }

  const rootNodes = nodes.filter(n => !n.parentId).sort((a, b) => a.sortOrder - b.sortOrder)

  const treeContent = (
    <>
      {rootNodes.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-10">
          「＋ ルートノード追加」または「🤖 AIツリー生成」でノードを追加してください
        </p>
      ) : (
        <div className="flex flex-col gap-4 w-max">
          {rootNodes.map(root => (
            <KpiTreeBranch key={root.id} node={root} allNodes={nodes} metricOptions={allMetricOptions}
              onUpdate={updateNode} onDelete={deleteNode}
              onAddChild={(pid) => addNode(pid)} onMove={moveNode} />
          ))}
        </div>
      )}
    </>
  )

  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 flex-wrap gap-2">
      <h3 className="text-sm font-semibold text-gray-700">📊 ツリー編集</h3>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => addNode()}
          className="text-xs px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition">
          ＋ ルートノード追加
        </button>
        <button onClick={onOpenCustomMetrics}
          className="text-xs px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 transition"
          title="計算式でカスタム指標を作成・管理">
          🧮 カスタム指標
        </button>
        <button onClick={generatePresets} disabled={genPresetsLoading}
          className="text-xs px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 transition disabled:opacity-50"
          title="ツリー構造からプリセットを自動生成">
          {genPresetsLoading ? '生成中...' : '🔗 プリセット自動生成'}
        </button>
        <button onClick={() => setShowAiModal(true)}
          className="text-xs px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition">
          🤖 AIツリー生成
        </button>
        <button onClick={() => setExpanded(v => !v)}
          className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition"
          title={expanded ? '縮小' : '全幅表示'}>
          {expanded ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 9L4 4m0 0l5 0M4 4l0 5M15 9l5-5m0 0l-5 0m5 0l0 5M9 15l-5 5m0 0l5 0m-5 0l0-5M15 15l5 5m0 0l-5 0m5 0l0-5" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )

  const footer = (
    <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
      <p className="text-[10px] text-gray-400">ダブルクリックでラベル編集 ／ ↑↓ で並び替え ／ ノードにカーソルで ＋ 子ノード追加</p>
      {genPresetsMsg && <p className="text-[10px] text-purple-600">{genPresetsMsg}</p>}
    </div>
  )

  return (
    <>
      {/* AI ツリー生成モーダル */}
      {showAiModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { if (!aiGenLoading) setShowAiModal(false) }} />
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-6 w-full max-w-lg pointer-events-auto space-y-4">
              <div>
                <h3 className="text-base font-bold text-gray-800">🤖 AI によるデータドリブン KPI ツリー生成</h3>
                <p className="text-xs text-gray-500 mt-1">プロジェクトの実指標値・トレンド・外生変数をもとに AI が最適な KPI ツリーを提案します。</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">参照期間</label>
                  <span className="text-xs font-mono text-amber-600">過去 {aiGenDays} 日</span>
                </div>
                <input type="range" min={7} max={90} step={7} value={aiGenDays}
                  onChange={e => setAiGenDays(parseInt(e.target.value))} className="w-full accent-amber-500" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>7日</span><span>30日</span><span>60日</span><span>90日</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">目標（任意）</label>
                <textarea value={aiGenGoal} onChange={e => setAiGenGoal(e.target.value)}
                  placeholder="例: Instagramのリーチとエンゲージメントを同時に最大化したい"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-amber-400 resize-none" rows={2} />
              </div>
              {aiGenResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-xs space-y-1">
                  <p className="font-semibold text-green-800">✅ ツリーを生成しました</p>
                  <p className="text-green-700">参照期間: {aiGenResult.period.start} 〜 {aiGenResult.period.end}（{aiGenResult.period.days}日）</p>
                  <p className="text-green-700">実データあり指標: {aiGenResult.dataPoints} 件を分析してツリーを設計しました</p>
                </div>
              )}
              {aiGenError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">{aiGenError}</div>
              )}
              {aiGenResult ? (
                <button onClick={() => { setShowAiModal(false); setAiGenResult(null) }}
                  className="w-full py-2 text-sm font-semibold rounded-xl bg-green-600 text-white hover:bg-green-700 transition">
                  閉じる
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => generateAiTree(false)} disabled={aiGenLoading}
                    className="flex-1 py-2 text-sm font-semibold rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition disabled:opacity-50">
                    {aiGenLoading ? '生成中...' : '既存ノードに追加'}
                  </button>
                  <button onClick={() => generateAiTree(true)} disabled={aiGenLoading}
                    className="flex-1 py-2 text-sm font-semibold rounded-xl border border-red-300 text-red-600 hover:bg-red-50 transition disabled:opacity-50">
                    全て置き換え
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {expanded ? (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setExpanded(false)} />
          <div className="fixed inset-4 z-50 bg-white rounded-2xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden">
            {header}
            <div className="flex-1 overflow-auto p-6">{treeContent}</div>
            {footer}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-b-xl border-x border-b border-gray-200 shadow-sm overflow-hidden">
          {header}
          <div className="p-6 overflow-x-auto min-h-[180px]">{treeContent}</div>
          {footer}
        </div>
      )}
    </>
  )
}

// ── KpiTreeTabManager（メインエクスポート）──────────────────────────────────────

export function KpiTreeTabManager({
  projectId,
  metricOptions,
  onPresetsGenerated,
  selectedTreeId,
  onTreeChange,
}: {
  projectId:           string
  metricOptions:       MetricOption[]
  onPresetsGenerated?: (treeId: string) => void
  selectedTreeId:      string | null
  onTreeChange:        (treeId: string) => void
}) {
  const { data: resp, mutate } = useSWR<{ success: boolean; data: { id: string; name: string; created_at: string }[] }>(
    `/api/projects/${projectId}/kpi-trees`,
    fetcher,
  )
  const trees: KpiTree[] = (resp?.data ?? []).map(t => ({
    id:        t.id,
    name:      t.name,
    createdAt: t.created_at,
  }))

  // カスタム指標
  const [showCustomModal,  setShowCustomModal]  = useState(false)
  const [customMetricsKey, setCustomMetricsKey] = useState(0)
  const { data: customResp } = useSWR<{ success: boolean; data: CustomMetric[] }>(
    `/api/projects/${projectId}/custom-metrics?_k=${customMetricsKey}`,
    fetcher,
  )
  const customMetrics = customResp?.data ?? []

  // ツリーが読み込まれたら先頭を選択
  useEffect(() => {
    if (trees.length > 0 && !selectedTreeId) {
      onTreeChange(trees[0].id)
    }
  }, [trees, selectedTreeId, onTreeChange])

  const [renamingId,  setRenamingId]  = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // テンプレから作成
  const [showTemplates, setShowTemplates] = useState(false)
  const { data: tplResp, isLoading: isTplLoading } = useSWR<{ success: boolean; data: KpiTreeTemplate[] }>(
    showTemplates ? `/api/projects/${projectId}/kpi-tree/templates` : null,
    fetcher,
  )
  const templates = tplResp?.success ? (tplResp.data ?? []) : []
  const [creatingFromTpl, setCreatingFromTpl] = useState(false)

  const createTree = async () => {
    const res  = await fetch(`/api/projects/${projectId}/kpi-trees`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: '新規ツリー' }),
    })
    const json = await res.json()
    if (json.success) {
      mutate()
      onTreeChange(json.data.id)
    }
  }

  const createTreeFromTemplate = async (templateKey: string) => {
    if (creatingFromTpl) return
    setCreatingFromTpl(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/kpi-tree/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey }),
      })
      const json = await res.json()
      if (!json.success) {
        alert(json.error ?? 'テンプレ適用に失敗しました')
        return
      }
      await mutate()
      onTreeChange(json.data.treeId)
      setShowTemplates(false)
    } finally {
      setCreatingFromTpl(false)
    }
  }

  const renameTree = async (id: string) => {
    if (!renameValue.trim()) return
    await fetch(`/api/projects/${projectId}/kpi-trees/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: renameValue.trim() }),
    })
    mutate()
    setRenamingId(null)
  }

  const deleteTree = async (id: string) => {
    if (!confirm('このツリーと関連するプリセット・重みバージョンをすべて削除しますか？')) return
    await fetch(`/api/projects/${projectId}/kpi-trees/${id}`, { method: 'DELETE' })
    mutate()
    if (selectedTreeId === id) {
      const remaining = trees.filter(t => t.id !== id)
      onTreeChange(remaining[0]?.id ?? '')
    }
  }

  const activeTree = trees.find(t => t.id === selectedTreeId)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-visible">
      {/* ツリータブ行 */}
      <div className="flex items-center gap-0 px-3 pt-3 pb-0 border-b border-gray-200 overflow-x-auto">
        {trees.map(tree => (
          <div key={tree.id}
            className={`relative group flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm transition select-none flex-shrink-0 border-b-2 -mb-px cursor-pointer ${
              selectedTreeId === tree.id
                ? 'text-purple-700 border-purple-600 bg-white font-semibold'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => { if (renamingId !== tree.id) onTreeChange(tree.id) }}>
            {renamingId === tree.id ? (
              <input autoFocus value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => renameTree(tree.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') renameTree(tree.id)
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                onClick={e => e.stopPropagation()}
                className="w-24 text-sm border-b border-purple-400 bg-transparent outline-none"
              />
            ) : (
              <span onDoubleClick={e => {
                e.stopPropagation()
                setRenamingId(tree.id)
                setRenameValue(tree.name)
              }} title="ダブルクリックで名前変更">
                🌳 {tree.name}
              </span>
            )}
            {selectedTreeId === tree.id && trees.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); deleteTree(tree.id) }}
                className="hidden group-hover:flex w-4 h-4 items-center justify-center text-[10px] text-gray-300 hover:text-red-500 rounded"
                title="ツリーを削除">✕</button>
            )}
          </div>
        ))}
        <button onClick={createTree}
          className="ml-1 mb-px px-2 py-1.5 text-xs text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-t-lg transition flex items-center gap-0.5">
          ＋ 新規ツリー
        </button>
        <button
          onClick={() => setShowTemplates(true)}
          className="ml-1 mb-px px-2 py-1.5 text-xs text-gray-400 hover:text-purple-700 hover:bg-purple-50 rounded-t-lg transition flex items-center gap-0.5"
        >
          ✨ テンプレから作成
        </button>
      </div>

      {/* ツリーエディタ */}
      {activeTree && selectedTreeId ? (
        <KpiTreeEditor
          projectId={projectId}
          treeId={selectedTreeId}
          metricOptions={metricOptions}
          customMetrics={customMetrics}
          onPresetsGenerated={() => onPresetsGenerated?.(selectedTreeId)}
          onOpenCustomMetrics={() => setShowCustomModal(true)}
        />
      ) : trees.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-gray-400 mb-3">KPI ツリーがまだありません</p>
          <button onClick={createTree}
            className="text-sm px-4 py-2 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 transition">
            ＋ 最初のツリーを作成
          </button>
        </div>
      ) : (
        <div className="p-8 text-center">
          <p className="text-sm text-gray-400">ツリーを読み込み中...</p>
        </div>
      )}

      {/* カスタム指標管理モーダル */}
      {showCustomModal && (
        <CustomMetricManager
          projectId={projectId}
          metricOptions={metricOptions}
          onClose={() => setShowCustomModal(false)}
          onMetricsChange={() => setCustomMetricsKey(k => k + 1)}
        />
      )}

      {/* テンプレ選択モーダル */}
      {showTemplates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !creatingFromTpl && setShowTemplates(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[720px] max-w-[92vw] p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-bold text-gray-900">テンプレからKPIツリーを作成</div>
                <div className="text-xs text-gray-500">全クライアント共通のテンプレ一覧から選んで、このプロジェクトに複製します。</div>
              </div>
              <button
                onClick={() => setShowTemplates(false)}
                disabled={creatingFromTpl}
                className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {isTplLoading ? (
              <div className="py-10 flex items-center justify-center">
                <div className="w-7 h-7 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
              </div>
            ) : templates.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">利用可能なテンプレがありません</div>
            ) : (
              <div className="max-h-[60vh] overflow-auto border rounded-xl">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-3 py-2 text-xs text-gray-500">テンプレ</th>
                      <th className="text-left px-3 py-2 text-xs text-gray-500">スコープ</th>
                      <th className="text-left px-3 py-2 text-xs text-gray-500">業種</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map(t => (
                      <tr key={t.id} className="border-b border-gray-100 hover:bg-purple-50/30">
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900">{t.name}</div>
                          <div className="text-[11px] text-gray-400">{t.template_key} / v{t.version_no}</div>
                          {t.description && <div className="text-xs text-gray-600 mt-1">{t.description}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {t.scope === 'service_type' ? 'サービス別' : '横断'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">{t.target_industry ?? '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            disabled={creatingFromTpl}
                            onClick={() => createTreeFromTemplate(t.template_key)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-300 transition"
                          >
                            このテンプレで作成
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
