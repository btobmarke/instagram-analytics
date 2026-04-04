'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { KpiMaster, AnalysisPromptSetting } from '@/types'

type Tab = 'account' | 'kpi' | 'prompts' | 'strategy'

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: 'account', label: 'アカウント設定' },
  { id: 'kpi', label: 'KPI設定' },
  { id: 'prompts', label: 'プロンプト設定' },
  { id: 'strategy', label: '戦略設定' },
]

const KPI_CATEGORY_LABELS: Record<string, string> = {
  engagement: 'エンゲージメント',
  reach: 'リーチ',
  growth: '成長',
  content: 'コンテンツ',
  conversion: 'コンバージョン',
}

const PROMPT_TYPE_LABELS: Record<string, string> = {
  post_analysis: '投稿単体分析',
  post_comparison: '投稿比較分析',
  account_weekly: '週次アカウント分析',
  account_monthly: '月次アカウント分析',
}

interface KpiTargetRow {
  kpi_id: string
  enabled: boolean
  target_value: string
  warning_threshold: string
  critical_threshold: string
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const accountId = searchParams.get('account')
  const [tab, setTab] = useState<Tab>('account')

  // Account settings state
  const [kpiSettings, setKpiSettings] = useState<Record<string, string>>({
    target_followers: '',
    target_engagement_rate: '',
    target_reach_per_post: '',
    target_saves_per_post: '',
    target_posts_per_week: '',
    target_monthly_follower_gain: '',
  })

  // KPI master + targets
  const [kpiMasters, setKpiMasters] = useState<KpiMaster[]>([])
  const [kpiTargets, setKpiTargets] = useState<Record<string, KpiTargetRow>>({})

  // Prompt settings
  const [prompts, setPrompts] = useState<AnalysisPromptSetting[]>([])
  const [promptEdits, setPromptEdits] = useState<Record<string, string>>({})
  const [algorithmFetching, setAlgorithmFetching] = useState(false)
  const [algorithmInfo, setAlgorithmInfo] = useState<string | null>(null)

  // Strategy
  const [strategyText, setStrategyText] = useState('')

  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const showSaved = (msg: string) => {
    setSavedMsg(msg)
    setTimeout(() => setSavedMsg(null), 3000)
  }

  const fetchKpiData = useCallback(async () => {
    if (!accountId) return
    const res = await fetch(`/api/settings/kpi?account=${accountId}`)
    const json = await res.json()
    const ks = json.data?.kpi_settings
    if (ks) {
      setKpiSettings({
        target_followers: String(ks.target_followers ?? ''),
        target_engagement_rate: String(ks.target_engagement_rate ?? ''),
        target_reach_per_post: String(ks.target_reach_per_post ?? ''),
        target_saves_per_post: String(ks.target_saves_per_post ?? ''),
        target_posts_per_week: String(ks.target_posts_per_week ?? ''),
        target_monthly_follower_gain: String(ks.target_monthly_follower_gain ?? ''),
      })
    }

    const masters = (json.data?.kpi_masters ?? []) as KpiMaster[]
    setKpiMasters(masters)

    const targets = json.data?.kpi_targets ?? []
    const targetMap: Record<string, KpiTargetRow> = {}
    for (const t of targets) {
      targetMap[t.kpi_id] = {
        kpi_id: t.kpi_id,
        enabled: true,
        target_value: String(t.target_value ?? ''),
        warning_threshold: String(t.warning_threshold ?? ''),
        critical_threshold: String(t.critical_threshold ?? ''),
      }
    }
    // Initialize all masters
    for (const m of masters) {
      if (!targetMap[m.id]) {
        targetMap[m.id] = { kpi_id: m.id, enabled: false, target_value: '', warning_threshold: '', critical_threshold: '' }
      }
    }
    setKpiTargets(targetMap)
  }, [accountId])

  const fetchPrompts = useCallback(async () => {
    const res = await fetch('/api/settings/prompts')
    const json = await res.json()
    const ps = (json.data ?? []) as AnalysisPromptSetting[]
    setPrompts(ps)
    const edits: Record<string, string> = {}
    for (const p of ps) { edits[p.prompt_type] = p.prompt_text }
    setPromptEdits(edits)
    const withAlgo = ps.find(p => p.algorithm_info)
    if (withAlgo) setAlgorithmInfo(withAlgo.algorithm_info ?? null)
  }, [])

  const fetchStrategy = useCallback(async () => {
    if (!accountId) return
    const res = await fetch(`/api/settings/strategy?account=${accountId}`)
    const json = await res.json()
    setStrategyText(json.data?.strategy_text ?? '')
  }, [accountId])

  useEffect(() => {
    fetchKpiData()
    fetchPrompts()
    fetchStrategy()
  }, [fetchKpiData, fetchPrompts, fetchStrategy])

  // Save handlers
  const saveAccountKpi = async () => {
    if (!accountId) return
    setSaving(true)
    await fetch(`/api/settings/kpi?account=${accountId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kpi_settings: {
        target_followers: kpiSettings.target_followers ? parseInt(kpiSettings.target_followers) : null,
        target_engagement_rate: kpiSettings.target_engagement_rate ? parseFloat(kpiSettings.target_engagement_rate) : null,
        target_reach_per_post: kpiSettings.target_reach_per_post ? parseInt(kpiSettings.target_reach_per_post) : null,
        target_saves_per_post: kpiSettings.target_saves_per_post ? parseInt(kpiSettings.target_saves_per_post) : null,
        target_posts_per_week: kpiSettings.target_posts_per_week ? parseFloat(kpiSettings.target_posts_per_week) : null,
        target_monthly_follower_gain: kpiSettings.target_monthly_follower_gain ? parseInt(kpiSettings.target_monthly_follower_gain) : null,
      }}),
    })
    setSaving(false)
    showSaved('アカウント設定を保存しました')
  }

  const saveKpiTargets = async () => {
    if (!accountId) return
    setSaving(true)
    const enabledTargets = Object.values(kpiTargets)
      .filter(t => t.enabled && (t.target_value !== ''))
      .map(t => ({
        kpi_id: t.kpi_id,
        grain: 'monthly',
        start_date: new Date().toISOString().slice(0, 10),
        target_value: parseFloat(t.target_value),
        warning_threshold: t.warning_threshold ? parseFloat(t.warning_threshold) : null,
        critical_threshold: t.critical_threshold ? parseFloat(t.critical_threshold) : null,
      }))

    await fetch(`/api/settings/kpi?account=${accountId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kpi_targets: enabledTargets }),
    })
    setSaving(false)
    showSaved('KPI設定を保存しました')
  }

  const savePrompts = async () => {
    setSaving(true)
    const promptArr = Object.entries(promptEdits).map(([prompt_type, prompt_text]) => ({ prompt_type, prompt_text }))
    await fetch('/api/settings/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: promptArr }),
    })
    setSaving(false)
    showSaved('プロンプト設定を保存しました')
  }

  const fetchAlgorithmInfo = async () => {
    setAlgorithmFetching(true)
    const res = await fetch('/api/settings/prompts', { method: 'POST' })
    const json = await res.json()
    setAlgorithmInfo(json.data?.algorithm_info ?? null)
    setAlgorithmFetching(false)
    showSaved('アルゴリズム情報を取得しました')
  }

  const saveStrategy = async () => {
    if (!accountId) return
    setSaving(true)
    await fetch(`/api/settings/strategy?account=${accountId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy_text: strategyText }),
    })
    setSaving(false)
    showSaved('戦略設定を保存しました')
  }

  // Group KPIs by category
  const kpiByCategory = kpiMasters.reduce<Record<string, KpiMaster[]>>((acc, kpi) => {
    if (!acc[kpi.category]) acc[kpi.category] = []
    acc[kpi.category].push(kpi)
    return acc
  }, {})

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">設定</h1>
        {savedMsg && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 text-green-700 text-sm font-medium rounded-xl">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {savedMsg}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {TAB_LABELS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* === Account Settings Tab === */}
      {tab === 'account' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-800 mb-1">KPI目標値（簡易設定）</h2>
          <p className="text-sm text-gray-500 mb-6">アカウント全体の主要目標値を設定します。詳細なKPI設定は「KPI設定」タブで行えます。</p>

          {!accountId && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-xl text-sm mb-4">
              アカウントを選択してください
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'target_followers', label: '目標フォロワー数', placeholder: '10000', unit: '人' },
              { key: 'target_engagement_rate', label: '目標エンゲージメント率', placeholder: '5.0', unit: '%' },
              { key: 'target_reach_per_post', label: '目標リーチ数/投稿', placeholder: '500', unit: '人' },
              { key: 'target_saves_per_post', label: '目標保存数/投稿', placeholder: '50', unit: '件' },
              { key: 'target_posts_per_week', label: '目標投稿頻度/週', placeholder: '3', unit: '回' },
              { key: 'target_monthly_follower_gain', label: '目標月次フォロワー増加', placeholder: '300', unit: '人' },
            ].map(({ key, label, placeholder, unit }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={kpiSettings[key] ?? ''}
                    onChange={e => setKpiSettings(s => ({ ...s, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="input"
                    disabled={!accountId}
                  />
                  <span className="text-sm text-gray-400 flex-shrink-0">{unit}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-6">
            <button onClick={saveAccountKpi} disabled={saving || !accountId} className="btn-primary">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* === KPI Settings Tab === */}
      {tab === 'kpi' && (
        <div className="space-y-4">
          {!accountId && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-xl text-sm">
              アカウントを選択してください
            </div>
          )}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 text-sm text-gray-500 shadow-sm">
            <p>各KPIの有効/無効と目標値を設定します。有効にしたKPIはアカウント分析画面に表示されます。</p>
          </div>

          {Object.entries(kpiByCategory).map(([category, kpis]) => (
            <div key={category} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">{KPI_CATEGORY_LABELS[category] ?? category}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-50">
                      <th className="text-left text-xs font-medium text-gray-400 px-6 py-2 w-8">有効</th>
                      <th className="text-left text-xs font-medium text-gray-400 px-4 py-2">KPI名</th>
                      <th className="text-left text-xs font-medium text-gray-400 px-4 py-2">計算方式</th>
                      <th className="text-left text-xs font-medium text-gray-400 px-4 py-2 w-32">目標値</th>
                      <th className="text-left text-xs font-medium text-gray-400 px-4 py-2 w-32">警告閾値</th>
                      <th className="text-left text-xs font-medium text-gray-400 px-4 py-2 w-32">危険閾値</th>
                      <th className="text-left text-xs font-medium text-gray-400 px-4 py-2 w-16">単位</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {kpis.map(kpi => {
                      const t = kpiTargets[kpi.id]
                      const enabled = t?.enabled ?? false
                      return (
                        <tr key={kpi.id} className={enabled ? '' : 'opacity-50'}>
                          <td className="px-6 py-3">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={e => setKpiTargets(prev => ({
                                ...prev,
                                [kpi.id]: { ...prev[kpi.id], kpi_id: kpi.id, enabled: e.target.checked }
                              }))}
                              className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-800">{kpi.kpi_name}</p>
                            {kpi.description && (
                              <p className="text-xs text-gray-400 mt-0.5">{kpi.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            <span className={`px-2 py-0.5 rounded-full font-medium ${
                              kpi.capability_type === 'DIRECT_API' ? 'bg-blue-100 text-blue-600' :
                              kpi.capability_type === 'DERIVED' ? 'bg-purple-100 text-purple-600' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {kpi.capability_type}
                            </span>
                            {kpi.formula_type && (
                              <span className="ml-1.5 text-gray-400">{kpi.formula_type}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={t?.target_value ?? ''}
                              onChange={e => setKpiTargets(prev => ({
                                ...prev,
                                [kpi.id]: { ...prev[kpi.id], kpi_id: kpi.id, target_value: e.target.value }
                              }))}
                              disabled={!enabled}
                              placeholder="—"
                              className="w-full px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:bg-gray-50"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={t?.warning_threshold ?? ''}
                              onChange={e => setKpiTargets(prev => ({
                                ...prev,
                                [kpi.id]: { ...prev[kpi.id], kpi_id: kpi.id, warning_threshold: e.target.value }
                              }))}
                              disabled={!enabled}
                              placeholder="—"
                              className="w-full px-2 py-1 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:bg-gray-50"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={t?.critical_threshold ?? ''}
                              onChange={e => setKpiTargets(prev => ({
                                ...prev,
                                [kpi.id]: { ...prev[kpi.id], kpi_id: kpi.id, critical_threshold: e.target.value }
                              }))}
                              disabled={!enabled}
                              placeholder="—"
                              className="w-full px-2 py-1 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400 disabled:bg-gray-50"
                            />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">{kpi.unit_type}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="flex justify-end">
            <button onClick={saveKpiTargets} disabled={saving || !accountId} className="btn-primary">
              {saving ? '保存中...' : 'KPI設定を保存'}
            </button>
          </div>
        </div>
      )}

      {/* === Prompts Tab === */}
      {tab === 'prompts' && (
        <div className="space-y-4">
          {/* Algorithm info */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold text-gray-800">Instagramアルゴリズム情報</h2>
                <p className="text-sm text-gray-500 mt-0.5">最新のInstagramアルゴリズムをClaudeが調査し、プロンプトに組み込みます</p>
              </div>
              <button
                onClick={fetchAlgorithmInfo}
                disabled={algorithmFetching}
                className="flex items-center gap-2 btn-secondary text-sm"
              >
                {algorithmFetching ? (
                  <><div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />取得中...</>
                ) : (
                  <>最新情報を取得</>
                )}
              </button>
            </div>
            {algorithmInfo ? (
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {algorithmInfo}
              </div>
            ) : (
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-400 text-center">
                「最新情報を取得」ボタンでInstagramアルゴリズムの情報を取得します
              </div>
            )}
          </div>

          {/* Prompt editors */}
          {Object.entries(PROMPT_TYPE_LABELS).map(([type, label]) => (
            <div key={type} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">{label}</h2>
              <textarea
                value={promptEdits[type] ?? ''}
                onChange={e => setPromptEdits(prev => ({ ...prev, [type]: e.target.value }))}
                rows={6}
                className="input resize-none font-mono text-xs leading-relaxed"
                placeholder={`${label}のプロンプトを入力してください...`}
              />
            </div>
          ))}

          <div className="flex justify-end">
            <button onClick={savePrompts} disabled={saving} className="btn-primary">
              {saving ? '保存中...' : 'プロンプトを保存'}
            </button>
          </div>
        </div>
      )}

      {/* === Strategy Tab === */}
      {tab === 'strategy' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-800 mb-1">アカウント戦略・方針</h2>
          <p className="text-sm text-gray-500 mb-4">
            このアカウントの運用方針・ターゲット・コンセプトを記述します。AI分析の際にこの情報が考慮されます。
          </p>

          {!accountId && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-xl text-sm mb-4">
              アカウントを選択してください
            </div>
          )}

          <textarea
            value={strategyText}
            onChange={e => setStrategyText(e.target.value)}
            rows={12}
            disabled={!accountId}
            placeholder={`例：
・ターゲット: 30〜40代の働く女性
・テーマ: ライフスタイル、美容、健康
・投稿スタイル: 温かみのある写真、丁寧なキャプション
・目的: ブランド認知向上とECサイトへの送客
・投稿頻度: 週3〜4回（フィード2回 + リール1〜2回）
・特記事項: コメントへの返信を重視、ストーリーは毎日更新`}
            className="input resize-none leading-relaxed"
          />

          <div className="flex justify-end mt-4">
            <button onClick={saveStrategy} disabled={saving || !accountId} className="btn-primary">
              {saving ? '保存中...' : '戦略を保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>}>
      <SettingsContent />
    </Suspense>
  )
}
