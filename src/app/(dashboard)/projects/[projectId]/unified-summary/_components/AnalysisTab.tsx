'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import useSWR from 'swr'

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
    ridgeLambda:  number
    vif:          { label: string; vif: number }[]
  }
  vif:              { label: string; vif: number }[]
  warnings:         string[]
  savedWeightVersion?: object | null
}

interface WeightVersion {
  id:              string
  presetId:        string
  versionNo:       number
  name:            string
  targetRef:       string
  featureRefs:     string[]
  coefficients:    { label: string; coef: number; vif?: number | null }[]
  intercept:       number
  r2:              number
  nObs:            number
  ridgeLambda:     number
  hasCollinearity: boolean
  analysisStart:   string
  analysisEnd:     string
  createdAt:       string
}

interface StrategyPlan {
  id:              string
  name:            string
  strategyType:    string
  yTarget:         number
  yCurrent:        number
  allocations:     AllocationItem[]
  aiEvaluation:    AiEvaluation | null
  evaluatedAt:     string | null
  createdAt:       string
}

interface AllocationItem {
  ref:      string
  label:    string
  current:  number
  target:   number
  delta:    number
  deltaPct: number
}

interface AiEvaluation {
  yAchievementRate: number
  aiComment:        string
  evalStart:        string
  evalEnd:          string
  actualY:          number
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

// ── KPI ノードカード ──────────────────────────────────────────────────────────

function KpiNodeCard({
  node,
  siblings,
  hasChildren,
  collapsed,
  onToggleCollapse,
  metricOptions,
  onUpdate,
  onDelete,
  onAddChild,
  onMove,
}: {
  node:              KpiNode
  siblings:          KpiNode[]
  hasChildren:       boolean
  collapsed:         boolean
  onToggleCollapse:  () => void
  metricOptions:     MetricOption[]
  onUpdate:          (id: string, updates: Partial<KpiNode>) => void
  onDelete:          (id: string) => void
  onAddChild:        (parentId: string) => void
  onMove:            (id: string, dir: 'up' | 'down') => void
}) {
  const [editing,  setEditing]  = useState(false)
  const [labelVal, setLabelVal] = useState(node.label)

  const myIndex     = siblings.findIndex(s => s.id === node.id)
  const canMoveUp   = myIndex > 0
  const canMoveDown = myIndex < siblings.length - 1
  const isBranch    = hasChildren

  const commitLabel = () => {
    if (labelVal.trim() && labelVal !== node.label) {
      onUpdate(node.id, { label: labelVal.trim() })
    }
    setEditing(false)
  }

  return (
    <div className={`
      relative group rounded-xl border shadow-sm transition-shadow
      min-w-[120px] max-w-[200px]
      hover:shadow-md
      ${isBranch ? 'border-purple-200 bg-purple-50' : 'border-indigo-200 bg-white'}
    `}>
      <div className={`
        absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full
        ${isBranch ? 'bg-purple-400' : 'bg-indigo-400'}
      `} />

      <div className="px-3 pl-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {hasChildren ? (
            <button
              onClick={onToggleCollapse}
              className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-transform duration-150"
              title={collapsed ? '展開' : '折りたたむ'}
            >
              <svg className={`w-3 h-3 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
                fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          ) : (
            <span className="flex-shrink-0 w-4" />
          )}
          <span className="text-sm leading-none flex-shrink-0">{isBranch ? '📊' : '📌'}</span>
          {editing ? (
            <input
              autoFocus
              value={labelVal}
              onChange={e => setLabelVal(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={e => {
                if (e.key === 'Enter') commitLabel()
                if (e.key === 'Escape') { setLabelVal(node.label); setEditing(false) }
              }}
              className="flex-1 text-sm border-b border-purple-400 bg-transparent outline-none min-w-0 w-28"
            />
          ) : (
            <span
              className={`text-sm font-medium truncate cursor-text select-none ${isBranch ? 'text-purple-900' : 'text-gray-800'}`}
              onDoubleClick={() => { setEditing(true); setLabelVal(node.label) }}
              title={`${node.label}（ダブルクリックで編集）`}
            >
              {node.label}
            </span>
          )}
        </div>

        <select
          value={node.metricRef ? `${node.serviceId}::${node.metricRef}` : ''}
          onChange={e => {
            const v = e.target.value
            if (!v) { onUpdate(node.id, { serviceId: null, metricRef: null }); return }
            const [svcId, ...rest] = v.split('::')
            onUpdate(node.id, { serviceId: svcId, metricRef: rest.join('::') })
          }}
          className={`mt-1.5 w-full text-[10px] border rounded-md px-1.5 py-1 text-gray-600 ${
            isBranch ? 'border-purple-100 bg-purple-50/50' : 'border-gray-200 bg-white'
          }`}
        >
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
      <KpiNodeCard
        node={node} siblings={siblings}
        hasChildren={children.length > 0} collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(v => !v)}
        metricOptions={metricOptions}
        onUpdate={onUpdate} onDelete={onDelete} onAddChild={onAddChild} onMove={onMove}
      />
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

// ── KPIツリーエディタ ─────────────────────────────────────────────────────────

function KpiTreeEditor({
  projectId,
  metricOptions,
  onPresetsGenerated,
}: {
  projectId:           string
  metricOptions:       MetricOption[]
  onPresetsGenerated?: () => void
}) {
  const { data: resp, mutate } = useSWR<{ success: boolean; data: KpiNode[] }>(
    `/api/projects/${projectId}/kpi-tree/nodes`,
    fetcher,
  )
  const [nodes, setNodes] = useState<KpiNode[]>([])

  useEffect(() => {
    if (resp?.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setNodes(resp.data.map((n: any) => ({
        id:        n.id         as string,
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

  const addNode = async (parentId: string | null = null) => {
    const maxOrder = nodes.filter(n => n.parentId === parentId).reduce((m, n) => Math.max(m, n.sortOrder), -1)
    const res = await fetch(`/api/projects/${projectId}/kpi-tree/nodes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ parentId, label: '新規ノード', nodeType: 'leaf', sortOrder: maxOrder + 1 }),
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
        body:   JSON.stringify({ sortOrder: sibling.sortOrder }),
      }),
      fetch(`/api/projects/${projectId}/kpi-tree/nodes/${sibling.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ sortOrder: node.sortOrder }),
      }),
    ])
    mutate()
  }

  const [expanded,       setExpanded]       = useState(false)
  const [genPresetsLoading, setGenPresetsLoading] = useState(false)
  const [genPresetsMsg,  setGenPresetsMsg]  = useState<string | null>(null)
  const [aiGenLoading,   setAiGenLoading]   = useState(false)
  const [aiGenGoal,      setAiGenGoal]      = useState('')
  const [aiGenDays,      setAiGenDays]      = useState(30)
  const [aiGenResult,    setAiGenResult]    = useState<{ dataPoints: number; period: { start: string; end: string; days: number } } | null>(null)
  const [aiGenError,     setAiGenError]     = useState<string | null>(null)
  const [showAiModal,    setShowAiModal]    = useState(false)

  const generatePresets = async () => {
    setGenPresetsLoading(true)
    setGenPresetsMsg(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/kpi-tree/generate-presets`, { method: 'POST' })
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
        body:    JSON.stringify({
          goal:    aiGenGoal.trim() || undefined,
          replace,
          days:    aiGenDays,
        }),
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
            <KpiTreeBranch key={root.id} node={root} allNodes={nodes} metricOptions={metricOptions}
              onUpdate={updateNode} onDelete={deleteNode}
              onAddChild={(pid) => addNode(pid)} onMove={moveNode} />
          ))}
        </div>
      )}
    </>
  )

  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 flex-wrap gap-2">
      <h3 className="text-sm font-semibold text-gray-700">📊 KPI ツリー</h3>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => addNode()}
          className="text-xs px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition">
          ＋ ルートノード追加
        </button>
        <button
          onClick={generatePresets}
          disabled={genPresetsLoading}
          className="text-xs px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 transition disabled:opacity-50"
          title="ツリー構造からプリセットを自動生成"
        >
          {genPresetsLoading ? '生成中...' : '🔗 プリセット自動生成'}
        </button>
        <button
          onClick={() => setShowAiModal(true)}
          className="text-xs px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition"
        >
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
      {genPresetsMsg && (
        <p className="text-[10px] text-purple-600">{genPresetsMsg}</p>
      )}
    </div>
  )

  return (
    <>
      {/* AIツリー生成モーダル */}
      {showAiModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { if (!aiGenLoading) setShowAiModal(false) }} />
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-6 w-full max-w-lg pointer-events-auto space-y-4">
              <div>
                <h3 className="text-base font-bold text-gray-800">🤖 AI によるデータドリブン KPI ツリー生成</h3>
                <p className="text-xs text-gray-500 mt-1">
                  プロジェクトの実指標値・トレンド・外生変数（天気・祝日）をもとに、AI が最適な KPI ツリーを提案します。
                </p>
              </div>

              {/* 参照期間 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">参照期間</label>
                  <span className="text-xs font-mono text-amber-600">過去 {aiGenDays} 日</span>
                </div>
                <input
                  type="range" min={7} max={90} step={7} value={aiGenDays}
                  onChange={e => setAiGenDays(parseInt(e.target.value))}
                  className="w-full accent-amber-500"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>7日</span><span>30日</span><span>60日</span><span>90日</span>
                </div>
              </div>

              {/* 目標 */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">目標（任意）</label>
                <textarea
                  value={aiGenGoal}
                  onChange={e => setAiGenGoal(e.target.value)}
                  placeholder="例: Instagramのリーチとエンゲージメントを同時に最大化したい"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-amber-400 resize-none"
                  rows={2}
                />
              </div>

              {/* 生成結果フィードバック */}
              {aiGenResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-xs space-y-1">
                  <p className="font-semibold text-green-800">✅ ツリーを生成しました</p>
                  <p className="text-green-700">
                    参照期間: {aiGenResult.period.start} 〜 {aiGenResult.period.end}（{aiGenResult.period.days}日）
                  </p>
                  <p className="text-green-700">
                    実データあり指標: {aiGenResult.dataPoints} 件を分析してツリーを設計しました
                  </p>
                </div>
              )}

              {/* エラー */}
              {aiGenError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
                  {aiGenError}
                </div>
              )}

              {/* ボタン */}
              {aiGenResult ? (
                <button
                  onClick={() => { setShowAiModal(false); setAiGenResult(null) }}
                  className="w-full text-sm py-2 rounded-lg bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 transition"
                >
                  閉じる
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => generateAiTree(false)}
                    disabled={aiGenLoading}
                    className="flex-1 text-sm py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 transition disabled:opacity-50"
                  >
                    {aiGenLoading ? '🤖 AI分析中...' : '追記で生成'}
                  </button>
                  <button
                    onClick={() => generateAiTree(true)}
                    disabled={aiGenLoading}
                    className="flex-1 text-sm py-2 rounded-lg bg-red-100 text-red-700 font-semibold hover:bg-red-200 transition disabled:opacity-50"
                  >
                    {aiGenLoading ? '🤖 AI分析中...' : '置き換えで生成'}
                  </button>
                </div>
              )}

              {!aiGenResult && (
                <button
                  onClick={() => { if (!aiGenLoading) setShowAiModal(false) }}
                  className="w-full text-xs text-gray-400 hover:text-gray-600 transition"
                >
                  キャンセル
                </button>
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
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {header}
          <div className="p-6 overflow-x-auto min-h-[180px]">{treeContent}</div>
          {footer}
        </div>
      )}
    </>
  )
}

// ── プリセット管理 ────────────────────────────────────────────────────────────

function PresetManager({
  projectId,
  metricOptions,
  selectedPresetId,
  onSelect,
  refreshKey,
}: {
  projectId:        string
  metricOptions:    MetricOption[]
  selectedPresetId: string | null
  onSelect:         (preset: Preset | null) => void
  refreshKey?:      number
}) {
  const { data: resp, mutate } = useSWR<{ success: boolean; data: Preset[] }>(
    `/api/projects/${projectId}/analysis-presets`,
    fetcher,
  )
  const presets = resp?.data ?? []

  useEffect(() => { mutate() }, [refreshKey, mutate])

  const [showForm, setShowForm]     = useState(false)
  const [name, setName]             = useState('')
  const [targetRef, setTargetRef]   = useState('')
  const [featureRefs, setFeatureRefs] = useState<string[]>([])
  const [saving, setSaving]         = useState(false)

  const toggleFeature = (ref: string) => {
    setFeatureRefs(prev => prev.includes(ref) ? prev.filter(r => r !== ref) : [...prev, ref])
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
        <button onClick={() => setShowForm(v => !v)}
          className="text-xs px-2.5 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition">
          ＋ 新規
        </button>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b border-gray-100 bg-green-50/50 space-y-3">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="プリセット名（例: 新規獲得）"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-green-400" />
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Y 変数（目的変数）</p>
            <select value={targetRef} onChange={e => setTargetRef(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
              <option value="">選択してください</option>
              {metricOptions.map(m => (
                <option key={m.colKey} value={m.colKey}>{m.service}: {m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">X 変数（複数選択可）</p>
            <div className="max-h-36 overflow-y-auto space-y-0.5 border border-gray-200 rounded-lg p-2 bg-white">
              {metricOptions.map(m => (
                <label key={m.colKey} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-purple-700">
                  <input type="checkbox" checked={featureRefs.includes(m.colKey)} onChange={() => toggleFeature(m.colKey)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-purple-600" />
                  {m.service}: {m.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={savePreset}
              disabled={saving || !name.trim() || !targetRef || featureRefs.length === 0}
              className="flex-1 text-xs py-1.5 rounded-lg bg-green-600 text-white font-medium disabled:opacity-50 hover:bg-green-700 transition">
              {saving ? '保存中...' : '保存'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="p-2 min-h-[80px]">
        {presets.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">プリセットなし</p>
        ) : (
          presets.map(p => (
            <div key={p.id}
              onClick={() => onSelect(selectedPresetId === p.id ? null : p)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition group
                ${selectedPresetId === p.id ? 'bg-purple-50 text-purple-800' : 'hover:bg-gray-50 text-gray-700'}`}>
              <span className="flex-1 font-medium truncate">{p.name}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">X:{p.featureMetricRefs.length}</span>
              <button onClick={e => { e.stopPropagation(); deletePreset(p.id) }}
                className="hidden group-hover:block text-xs text-gray-300 hover:text-red-500">✕</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── 相関行列 ──────────────────────────────────────────────────────────────────

function CorrelationMatrix({
  correlation, columns, colLabel,
}: {
  correlation: { col1: string; col2: string; r: number; n: number }[]
  columns:     string[]
  colLabel:    (col: string) => string
}) {
  const getR = (a: string, b: string): number | null => {
    const found = correlation.find(c => (c.col1 === a && c.col2 === b) || (c.col1 === b && c.col2 === a))
    return found?.r ?? null
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-left text-gray-500 font-medium min-w-[100px]" />
            {columns.map(col => (
              <th key={col} className="px-2 py-1.5 text-center text-gray-600 font-medium whitespace-nowrap max-w-[80px]" title={colLabel(col)}>
                <span className="block truncate max-w-[72px]">{colLabel(col)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map(rowCol => (
            <tr key={rowCol} className="border-t border-gray-100">
              <td className="px-2 py-1.5 text-gray-600 font-medium whitespace-nowrap max-w-[120px]" title={colLabel(rowCol)}>
                <span className="block truncate max-w-[112px]">{colLabel(rowCol)}</span>
              </td>
              {columns.map(colCol => {
                const r = getR(rowCol, colCol)
                const isSelf = rowCol === colCol
                return (
                  <td key={colCol}
                    className={`px-2 py-1.5 text-center font-mono font-semibold rounded ${
                      isSelf ? 'bg-gray-200 text-gray-500' : r !== null ? corrColor(r) : 'text-gray-300'
                    }`}>
                    {isSelf ? '—' : r !== null ? r.toFixed(2) : 'N/A'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-400 mt-2">※ 相関関係は因果関係を示すものではありません。</p>
    </div>
  )
}

// ── 回帰結果 ──────────────────────────────────────────────────────────────────

function RegressionResult({
  regression, colLabel,
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
        {regression.ridgeLambda > 0 && (
          <div className="bg-orange-50 rounded-lg px-4 py-2 text-center">
            <p className="text-xs text-orange-500">Ridge λ</p>
            <p className="text-xl font-bold text-orange-700">{regression.ridgeLambda}</p>
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Y = {colLabel(regression.target)}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-3 py-1.5 font-medium text-gray-500">変数</th>
              <th className="text-right px-3 py-1.5 font-medium text-gray-500">係数</th>
              <th className="text-right px-3 py-1.5 font-medium text-gray-500">VIF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="px-3 py-1.5 text-gray-600">定数項</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-700">{regression.intercept.toFixed(4)}</td>
              <td className="px-3 py-1.5 text-right text-gray-400">—</td>
            </tr>
            {regression.coefficients.map((c, i) => {
              const vifVal = regression.vif?.[i]?.vif
              const highVif = vifVal && vifVal > 10
              return (
                <tr key={c.label}>
                  <td className="px-3 py-1.5 text-gray-700">{colLabel(c.label)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${
                    c.coef > 0 ? 'text-blue-700' : c.coef < 0 ? 'text-red-600' : 'text-gray-500'
                  }`}>
                    {c.coef > 0 ? '+' : ''}{c.coef.toFixed(4)}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono text-xs ${highVif ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                    {vifVal ? vifVal.toFixed(1) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400">
        ※ VIF &gt; 10 は多重共線性の可能性。Ridge λ &gt; 0 を推奨。
      </p>
    </div>
  )
}

// ── 重み・戦略パネル ──────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  proportional:   '① 比例貢献',
  equal_growth:   '② 均等成長率',
  efficiency_max: '③ 効率最大化',
  manual:         '④ 手動配分',
  elasticity:     '⑤ 弾力性表示',
}
const STRATEGY_DESCS: Record<string, string> = {
  proportional:   '各 X の貢献度（β×X）に比例してΔYを割り振る',
  equal_growth:   '全 X を同じ成長率で引き上げる',
  efficiency_max: '最も係数 β が大きい X のみを変化させる',
  manual:         '各 X の変化量を手動で入力し、期待 Y を計算する',
  elasticity:     '各 X を 1% 変化させたときの Y への影響（弾力性）を表示する',
}

function WeightStrategyPanel({
  projectId,
  colLabel,
  selectedPreset,
}: {
  projectId:      string
  colLabel:       (col: string) => string
  selectedPreset: Preset | null
}) {
  const { data: weightsResp, mutate: mutateWeights } = useSWR<{ success: boolean; data: object[] }>(
    selectedPreset
      ? `/api/projects/${projectId}/kpi-weights?presetId=${selectedPreset.id}`
      : null,
    fetcher,
  )

  const rawWeights = (weightsResp?.data ?? []) as Record<string, unknown>[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weights: WeightVersion[] = rawWeights.map((w: any) => ({
    id:              w.id as string,
    presetId:        w.preset_id as string,
    versionNo:       w.version_no as number,
    name:            w.name as string,
    targetRef:       w.target_ref as string,
    featureRefs:     w.feature_refs as string[],
    coefficients:    w.coefficients as { label: string; coef: number; vif?: number | null }[],
    intercept:       w.intercept as number,
    r2:              w.r2 as number,
    nObs:            w.n_obs as number,
    ridgeLambda:     w.ridge_lambda as number,
    hasCollinearity: w.has_collinearity as boolean,
    analysisStart:   w.analysis_start as string,
    analysisEnd:     w.analysis_end as string,
    createdAt:       w.created_at as string,
  }))

  const [selectedWeightId, setSelectedWeightId] = useState<string | null>(null)
  const selectedWeight = weights.find(w => w.id === selectedWeightId) ?? null

  const { data: stratResp, mutate: mutateStrat } = useSWR<{ success: boolean; data: object[] }>(
    selectedWeightId
      ? `/api/projects/${projectId}/kpi-strategy?weightVersionId=${selectedWeightId}`
      : null,
    fetcher,
  )
  const rawPlans = (stratResp?.data ?? []) as Record<string, unknown>[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plans: StrategyPlan[] = rawPlans.map((p: any) => ({
    id:           p.id as string,
    name:         p.name as string,
    strategyType: p.strategy_type as string,
    yTarget:      p.y_target as number,
    yCurrent:     p.y_current as number,
    allocations:  p.allocations as AllocationItem[],
    aiEvaluation: p.ai_evaluation as AiEvaluation | null,
    evaluatedAt:  p.evaluated_at as string | null,
    createdAt:    p.created_at as string,
  }))

  // 戦略作成フォーム
  const [strategyType, setStrategyType] = useState<string>('proportional')
  const [planName,     setPlanName]     = useState('')
  const [yTarget,      setYTarget]      = useState('')
  const [yCurrent,     setYCurrent]     = useState('')
  const [xCurrents,    setXCurrents]   = useState<Record<string, string>>({})
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({})
  const [saving,       setSaving]       = useState(false)
  const [saveMsg,      setSaveMsg]      = useState<string | null>(null)

  // 重みを選択したとき X の現在値フォームを初期化
  useEffect(() => {
    if (selectedWeight) {
      const init: Record<string, string> = {}
      selectedWeight.featureRefs.forEach(ref => { init[ref] = '' })
      setXCurrents(init)
      setManualInputs(init)
    }
  }, [selectedWeightId, selectedWeight])

  const computeStrategy = async () => {
    if (!selectedWeight || !planName || !yTarget || !yCurrent) return
    setSaving(true)
    setSaveMsg(null)
    const xCurrentsNum: Record<string, number> = {}
    Object.entries(xCurrents).forEach(([k, v]) => { xCurrentsNum[k] = parseFloat(v) || 0 })
    const manualNum: Record<string, number> = {}
    Object.entries(manualInputs).forEach(([k, v]) => { manualNum[k] = parseFloat(v) || 0 })

    const res = await fetch(`/api/projects/${projectId}/kpi-strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weightVersionId: selectedWeight.id,
        name:            planName,
        strategyType,
        yTarget:         parseFloat(yTarget),
        yCurrent:        parseFloat(yCurrent),
        xCurrents:       xCurrentsNum,
        manualInputs:    manualNum,
      }),
    })
    const json = await res.json()
    if (json.success) {
      setSaveMsg('戦略プランを保存しました')
      mutateStrat()
    } else {
      setSaveMsg(`エラー: ${json.error}`)
    }
    setSaving(false)
  }

  if (!selectedPreset) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
        <p className="text-sm text-gray-400">プリセットを選択してください</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 重みバージョン選択 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">⚖️ 重みバージョン選択</h3>
        {weights.length === 0 ? (
          <p className="text-xs text-gray-400">分析実行後に「重みを保存」すると、ここに一覧が表示されます</p>
        ) : (
          <div className="space-y-1.5">
            {weights.map(w => (
              <div key={w.id}
                onClick={() => setSelectedWeightId(prev => prev === w.id ? null : w.id)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer text-xs transition group ${
                  selectedWeightId === w.id
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className="font-semibold flex-shrink-0">v{w.versionNo}</span>
                <span className="flex-1 truncate">{w.name}</span>
                <span className="text-gray-400 flex-shrink-0">R²={w.r2.toFixed(3)}</span>
                <span className="text-gray-400 flex-shrink-0">{w.nObs}件</span>
                {w.hasCollinearity && (
                  <span className="text-orange-500 flex-shrink-0 font-bold" title="多重共線性あり">⚠</span>
                )}
                <button
                  onClick={async e => {
                    e.stopPropagation()
                    if (!confirm(`v${w.versionNo} を削除しますか？関連する戦略プランも削除されます。`)) return
                    await fetch(`/api/projects/${projectId}/kpi-weights/${w.id}`, { method: 'DELETE' })
                    if (selectedWeightId === w.id) setSelectedWeightId(null)
                    mutateWeights()
                  }}
                  className="hidden group-hover:flex items-center text-gray-300 hover:text-red-500 transition flex-shrink-0"
                  title="削除"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 戦略作成フォーム */}
      {selectedWeight && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">📋 配分戦略を立てる</h3>
          <p className="text-xs text-gray-500">
            Y: <strong>{colLabel(selectedWeight.targetRef)}</strong> の目標から各 X の配分を計算します
          </p>

          {/* 戦略タイプ */}
          <div className="grid grid-cols-1 gap-2">
            {Object.keys(STRATEGY_LABELS).map(key => (
              <label key={key}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition ${
                  strategyType === key ? 'bg-purple-50 border-purple-300' : 'border-gray-200 hover:bg-gray-50'
                }`}>
                <input type="radio" name="strategy" value={key}
                  checked={strategyType === key} onChange={() => setStrategyType(key)}
                  className="mt-0.5 text-purple-600" />
                <div>
                  <p className="text-xs font-semibold text-gray-800">{STRATEGY_LABELS[key]}</p>
                  <p className="text-[10px] text-gray-500">{STRATEGY_DESCS[key]}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Y 現在値</label>
              <input type="number" value={yCurrent} onChange={e => setYCurrent(e.target.value)}
                placeholder="例: 1000"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-purple-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Y 目標値</label>
              <input type="number" value={yTarget} onChange={e => setYTarget(e.target.value)}
                placeholder="例: 1200"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-purple-400" />
            </div>
          </div>

          {/* X 現在値入力 */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">X 変数の現在値</p>
            <div className="space-y-2">
              {selectedWeight.featureRefs.map(ref => (
                <div key={ref} className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 flex-1 truncate" title={colLabel(ref)}>{colLabel(ref)}</label>
                  <input type="number" value={xCurrents[ref] ?? ''}
                    onChange={e => setXCurrents(prev => ({ ...prev, [ref]: e.target.value }))}
                    placeholder="0"
                    className="w-24 text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-purple-400" />
                  {strategyType === 'manual' && (
                    <input type="number" value={manualInputs[ref] ?? ''}
                      onChange={e => setManualInputs(prev => ({ ...prev, [ref]: e.target.value }))}
                      placeholder="Δ入力"
                      className="w-20 text-xs border border-indigo-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-indigo-50" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">プラン名</label>
            <input value={planName} onChange={e => setPlanName(e.target.value)}
              placeholder="例: 4月目標プラン"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-purple-400" />
          </div>

          <button onClick={computeStrategy}
            disabled={saving || !planName || !yTarget || !yCurrent}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transition disabled:opacity-50">
            {saving ? '計算中...' : '⚡ 戦略を計算・保存'}
          </button>
          {saveMsg && <p className="text-xs text-center text-purple-600">{saveMsg}</p>}
        </div>
      )}

      {/* 保存済み戦略プラン */}
      {selectedWeight && plans.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">📌 保存済み戦略プラン</h3>
          <div className="space-y-3">
            {plans.map(plan => (
              <div key={plan.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-800 flex-1">{plan.name}</span>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    {STRATEGY_LABELS[plan.strategyType] ?? plan.strategyType}
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm(`「${plan.name}」を削除しますか？`)) return
                      await fetch(`/api/projects/${projectId}/kpi-strategy/${plan.id}`, { method: 'DELETE' })
                      mutateStrat()
                    }}
                    className="text-gray-300 hover:text-red-500 transition text-xs flex-shrink-0"
                    title="削除"
                  >✕</button>
                </div>
                <div className="text-xs text-gray-500">
                  Y 目標: {plan.yCurrent} → {plan.yTarget} (+{plan.yTarget - plan.yCurrent})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-2 py-1 text-gray-500 font-medium">指標</th>
                        <th className="text-right px-2 py-1 text-gray-500 font-medium">現在</th>
                        <th className="text-right px-2 py-1 text-gray-500 font-medium">目標</th>
                        <th className="text-right px-2 py-1 text-gray-500 font-medium">変化率</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {plan.allocations.map(a => (
                        <tr key={a.ref}>
                          <td className="px-2 py-1 text-gray-700 max-w-[120px] truncate" title={colLabel(a.label)}>{colLabel(a.label)}</td>
                          <td className="px-2 py-1 text-right font-mono text-gray-600">{a.current.toFixed(1)}</td>
                          <td className="px-2 py-1 text-right font-mono font-semibold text-blue-700">{a.target.toFixed(1)}</td>
                          <td className={`px-2 py-1 text-right font-mono font-semibold ${
                            a.deltaPct > 0 ? 'text-green-600' : a.deltaPct < 0 ? 'text-red-600' : 'text-gray-400'
                          }`}>
                            {a.deltaPct > 0 ? '+' : ''}{a.deltaPct.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {plan.aiEvaluation && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <p className="text-xs font-semibold text-amber-800 mb-1">
                      🤖 AI評価 ({plan.aiEvaluation.evalStart} 〜 {plan.aiEvaluation.evalEnd})
                    </p>
                    <p className="text-xs text-amber-700">達成率: {plan.aiEvaluation.yAchievementRate}%</p>
                    <p className="text-xs text-amber-700 mt-1 whitespace-pre-wrap line-clamp-4">{plan.aiEvaluation.aiComment}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── AI評価パネル ──────────────────────────────────────────────────────────────

function AiEvalPanel({
  projectId,
  colLabel,
  selectedPreset,
}: {
  projectId:      string
  colLabel:       (col: string) => string
  selectedPreset: Preset | null
}) {
  const { data: weightsResp } = useSWR<{ success: boolean; data: object[] }>(
    selectedPreset ? `/api/projects/${projectId}/kpi-weights?presetId=${selectedPreset.id}` : null,
    fetcher,
  )
  const rawWeights = (weightsResp?.data ?? []) as Record<string, unknown>[]
  const weightIds = rawWeights.map(w => w.id as string)

  // 全重みに紐づく全戦略プランを取得
  const [allPlans, setAllPlans] = useState<StrategyPlan[]>([])
  useEffect(() => {
    if (weightIds.length === 0) { setAllPlans([]); return }
    Promise.all(
      weightIds.map(wid =>
        fetch(`/api/projects/${projectId}/kpi-strategy?weightVersionId=${wid}`)
          .then(r => r.json())
          .then(j => j.data ?? [])
      )
    ).then(results => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flat = results.flat().map((p: any) => ({
        id:           p.id,
        name:         p.name,
        strategyType: p.strategy_type,
        yTarget:      p.y_target,
        yCurrent:     p.y_current,
        allocations:  p.allocations,
        aiEvaluation: p.ai_evaluation,
        evaluatedAt:  p.evaluated_at,
        createdAt:    p.created_at,
      }))
      setAllPlans(flat)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightsResp, projectId])

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const selectedPlan = allPlans.find(p => p.id === selectedPlanId)

  const [evalStart, setEvalStart] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [evalEnd,   setEvalEnd]   = useState(new Date().toISOString().slice(0, 10))
  const [actualY,   setActualY]   = useState('')
  const [actualXs,  setActualXs]  = useState<Record<string, string>>({})
  const [running,   setRunning]   = useState(false)
  const [evalResult, setEvalResult] = useState<AiEvaluation | null>(null)
  const [evalError,  setEvalError]  = useState<string | null>(null)

  useEffect(() => {
    if (selectedPlan) {
      const init: Record<string, string> = {}
      selectedPlan.allocations.forEach(a => { init[a.ref] = '' })
      setActualXs(init)
      setEvalResult(null)
    }
  }, [selectedPlanId, selectedPlan])

  const runEval = async () => {
    if (!selectedPlan) return
    setRunning(true)
    setEvalError(null)
    const xNums: Record<string, number> = {}
    Object.entries(actualXs).forEach(([k, v]) => { xNums[k] = parseFloat(v) || 0 })
    try {
      const res = await fetch(
        `/api/projects/${projectId}/kpi-strategy/${selectedPlan.id}/evaluate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ evalStart, evalEnd, actualY: parseFloat(actualY) || 0, actualXs: xNums }),
        }
      )
      const json = await res.json()
      if (json.success) setEvalResult(json.data)
      else setEvalError(json.error)
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  if (!selectedPreset) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
        <p className="text-sm text-gray-400">プリセットを選択してください</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 戦略プラン選択 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">🔍 評価する戦略プランを選択</h3>
        {allPlans.length === 0 ? (
          <p className="text-xs text-gray-400">戦略プランがまだありません。「重み・戦略」タブで戦略を作成してください。</p>
        ) : (
          <div className="space-y-1.5">
            {allPlans.map(plan => (
              <div key={plan.id}
                onClick={() => setSelectedPlanId(prev => prev === plan.id ? null : plan.id)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer text-xs transition ${
                  selectedPlanId === plan.id
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className="flex-1 font-semibold">{plan.name}</span>
                <span className="text-gray-400">{STRATEGY_LABELS[plan.strategyType] ?? plan.strategyType}</span>
                {plan.evaluatedAt && <span className="text-green-500">✓ 評価済</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 実績入力・評価実行 */}
      {selectedPlan && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">📊 実績データを入力して AI 評価を実行</h3>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 mb-1 block">評価期間 開始</label>
              <input type="date" value={evalStart} onChange={e => setEvalStart(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 mb-1 block">評価期間 終了</label>
              <input type="date" value={evalEnd} onChange={e => setEvalEnd(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">
              Y 実績値（{colLabel(selectedPlan.allocations[0]?.ref ? selectedPlan.allocations[0].ref : '')} の上位指標）
            </label>
            <input type="number" value={actualY} onChange={e => setActualY(e.target.value)}
              placeholder={`目標: ${selectedPlan.yTarget}`}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-amber-400" />
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">X 変数の実績値</p>
            <div className="space-y-2">
              {selectedPlan.allocations.map(a => (
                <div key={a.ref} className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 flex-1 truncate" title={colLabel(a.label)}>{colLabel(a.label)}</label>
                  <span className="text-xs text-gray-400 flex-shrink-0">目標: {a.target.toFixed(1)}</span>
                  <input type="number" value={actualXs[a.ref] ?? ''}
                    onChange={e => setActualXs(prev => ({ ...prev, [a.ref]: e.target.value }))}
                    placeholder="実績値"
                    className="w-24 text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
              ))}
            </div>
          </div>

          <button onClick={runEval} disabled={running || !actualY}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 transition disabled:opacity-50">
            {running ? '🤖 AI分析中...' : '🤖 AI評価を実行'}
          </button>

          {evalError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{evalError}</div>
          )}

          {evalResult && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="bg-white rounded-lg px-4 py-2 text-center border border-amber-200">
                  <p className="text-xs text-amber-600">Y 達成率</p>
                  <p className={`text-xl font-bold ${evalResult.yAchievementRate >= 100 ? 'text-green-700' : 'text-amber-700'}`}>
                    {evalResult.yAchievementRate}%
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-amber-800 mb-2">🤖 AI コメント</p>
                <p className="text-xs text-amber-900 whitespace-pre-wrap leading-relaxed">{evalResult.aiComment}</p>
              </div>
            </div>
          )}
        </div>
      )}
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
  const metricOptions: MetricOption[] = useMemo(() => {
    const svcMetrics = configServices.flatMap(svc =>
      svc.availableMetrics.map(m => ({
        colKey:  `${svc.id}::${m.id}`,
        label:   m.label,
        service: svc.name,
      }))
    )
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

  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)
  const [presetRefreshKey, setPresetRefreshKey] = useState(0)

  // タブ
  const [activeTab, setActiveTab] = useState<'analysis' | 'weights' | 'eval'>('analysis')

  // 分析設定
  const today          = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(thirtyDaysAgo)
  const [endDate,   setEndDate]   = useState(today)
  const [timeUnit,  setTimeUnit]  = useState<'day' | 'week' | 'month'>('day')
  const [ridgeLambda, setRidgeLambda] = useState(0)

  // 重み保存オプション
  const [saveWeights,  setSaveWeights]  = useState(false)
  const [versionName,  setVersionName]  = useState('')

  const [result,    setResult]    = useState<AnalysisResult | null>(null)
  const [running,   setRunning]   = useState(false)
  const [runError,  setRunError]  = useState<string | null>(null)

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
          ridgeLambda,
          saveWeights:       saveWeights && !!selectedPreset.id,
          presetId:          selectedPreset.id,
          versionName:       versionName.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'エラーが発生しました')
      setResult(json.data)
      if (json.data.savedWeightVersion) {
        setVersionName('')
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const tabs = [
    { key: 'analysis', label: '📈 分析' },
    { key: 'weights',  label: '⚖️ 重み・戦略' },
    { key: 'eval',     label: '🤖 AI評価' },
  ] as const

  return (
    <div className="space-y-5">
      {/* KPI ツリー（全幅） */}
      <KpiTreeEditor
        projectId={projectId}
        metricOptions={metricOptions}
        onPresetsGenerated={() => setPresetRefreshKey(k => k + 1)}
      />

      {/* タブナビゲーション */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {tabs.map(tab => (
            <button key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'text-purple-700 border-purple-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
              }`}>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 分析タブ */}
      {activeTab === 'analysis' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1">
            <PresetManager
              projectId={projectId}
              metricOptions={metricOptions}
              selectedPresetId={selectedPreset?.id ?? null}
              onSelect={setSelectedPreset}
              refreshKey={presetRefreshKey}
            />
          </div>

          <div className="lg:col-span-2 space-y-4">
            {/* 分析設定 */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">⚙️ 分析設定</h3>

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
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">終了日</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">粒度</label>
                  <select value={timeUnit} onChange={e => setTimeUnit(e.target.value as 'day' | 'week' | 'month')}
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-purple-400">
                    <option value="day">日次</option>
                    <option value="week">週次</option>
                    <option value="month">月次</option>
                  </select>
                </div>
              </div>

              {/* Ridge λ */}
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-500">Ridge 正則化 λ（多重共線性対策）</label>
                  <span className="text-xs font-mono text-orange-600">{ridgeLambda === 0 ? 'OLS（λ=0）' : `λ=${ridgeLambda}`}</span>
                </div>
                <input type="range" min={0} max={20} step={0.5} value={ridgeLambda}
                  onChange={e => setRidgeLambda(parseFloat(e.target.value))}
                  className="w-full accent-orange-500" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>OLS (λ=0)</span><span>弱正則化</span><span>強正則化 (λ=20)</span>
                </div>
              </div>

              {/* 重み保存オプション */}
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={saveWeights} onChange={e => setSaveWeights(e.target.checked)}
                    className="w-4 h-4 rounded text-purple-600 border-gray-300" />
                  <span className="text-xs text-gray-600 font-medium">分析結果の重みを保存する</span>
                </label>
                {saveWeights && (
                  <input value={versionName} onChange={e => setVersionName(e.target.value)}
                    placeholder="バージョン名（空欄で自動命名）"
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-purple-400" />
                )}
              </div>

              <button onClick={runAnalysis}
                disabled={!canRun || running}
                className="mt-3 px-5 py-1.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transition disabled:opacity-50">
                {running ? '計算中...' : '▶ 分析実行'}
              </button>

              {result?.savedWeightVersion && (
                <p className="text-xs text-purple-600 mt-2">✓ 重みを保存しました。「重み・戦略」タブで戦略を立てられます。</p>
              )}
            </div>

            {runError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{runError}</div>
            )}

            {result?.warnings && result.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
                ))}
              </div>
            )}

            {result && result.correlation.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="text-sm font-semibold text-gray-700">📐 相関行列</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{result.wideTable.length} 観測</p>
                </div>
                <div className="p-4">
                  <CorrelationMatrix correlation={result.correlation} columns={result.columns} colLabel={colLabel} />
                </div>
              </div>
            )}

            {result?.regression && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="text-sm font-semibold text-gray-700">
                    📈 {result.regression.ridgeLambda > 0 ? `Ridge 回帰（λ=${result.regression.ridgeLambda}）` : '線形回帰（OLS）'}
                  </h3>
                </div>
                <div className="p-4">
                  <RegressionResult regression={result.regression} colLabel={colLabel} />
                </div>
              </div>
            )}

            {result && result.wideTable.length === 0 && (
              <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
                <p className="text-sm text-gray-400">指定期間のキャッシュデータが見つかりませんでした。</p>
                <p className="text-xs text-gray-400 mt-1">バッチを実行してデータを蓄積してください。</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 重み・戦略タブ */}
      {activeTab === 'weights' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1">
            <PresetManager
              projectId={projectId}
              metricOptions={metricOptions}
              selectedPresetId={selectedPreset?.id ?? null}
              onSelect={setSelectedPreset}
              refreshKey={presetRefreshKey}
            />
          </div>
          <div className="lg:col-span-2">
            <WeightStrategyPanel
              projectId={projectId}
              colLabel={colLabel}
              selectedPreset={selectedPreset}
            />
          </div>
        </div>
      )}

      {/* AI評価タブ */}
      {activeTab === 'eval' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1">
            <PresetManager
              projectId={projectId}
              metricOptions={metricOptions}
              selectedPresetId={selectedPreset?.id ?? null}
              onSelect={setSelectedPreset}
              refreshKey={presetRefreshKey}
            />
          </div>
          <div className="lg:col-span-2">
            <AiEvalPanel
              projectId={projectId}
              colLabel={colLabel}
              selectedPreset={selectedPreset}
            />
          </div>
        </div>
      )}
    </div>
  )
}
