'use client'

import { use, useState } from 'react'
import useSWR from 'swr'

import { buildMaActionsFromDraft, MaActionsEditor, MaRuleActionsPanel } from './ma-actions-editor'
import type { ActionDraftRow } from './ma-actions-editor'


const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

type RuleKind = 'keyword' | 'follow' | 'unfollow'

interface MaRule {
  id: string
  rule_kind: RuleKind
  name: string
  enabled: boolean
  priority: number
  match_type: string | null
  pattern: string | null
  reply_text: string | null
  actions: unknown
}

interface Scenario {
  id: string
  name: string
  description: string | null
  enabled: boolean
}

interface ScenarioStep {
  step_order: number
  delay_before_seconds: number
  message_text: string
}

interface Reminder {
  id: string
  contact_id: string
  message_text: string
  run_at: string
  status: string
}

export default function LineMaAutomationPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const { data: rulesResp, mutate: mutRules } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/ma-rules` : null,
    fetcher,
  )
  const rules: MaRule[] = rulesResp?.data ?? []

  const { data: scenResp, mutate: mutScen } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/scenarios` : null,
    fetcher,
  )
  const scenarios: Scenario[] = scenResp?.data ?? []

  const { data: tagsResp } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/tags` : null,
    fetcher,
  )
  const tagOptions: { id: string; name: string }[] = tagsResp?.data ?? []

  const { data: defsResp } = useSWR(
    service?.service_type === 'line'
      ? `/api/services/${serviceId}/line-messaging/attribute-definitions`
      : null,
    fetcher,
  )
  const definitionOptions: {
    id: string
    label: string
    code: string
    value_type: string
    select_options: string[] | null
  }[] = defsResp?.data ?? []

  const { data: tplResp } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/templates` : null,
    fetcher,
  )
  const templateOptions: { id: string; name: string }[] = tplResp?.data ?? []

  const { data: remResp, mutate: mutRem } = useSWR(
    service?.service_type === 'line'
      ? `/api/services/${serviceId}/line-messaging/reminders?status=scheduled`
      : null,
    fetcher,
  )
  const reminders: Reminder[] = remResp?.data ?? []

  const [ruleKind, setRuleKind] = useState<RuleKind>('keyword')
  const [rName, setRName] = useState('')
  const [rPriority, setRPriority] = useState('100')
  const [rMatch, setRMatch] = useState<'exact' | 'contains'>('contains')
  const [rPattern, setRPattern] = useState('')
  const [rReply, setRReply] = useState('')
  const [ruleBusy, setRuleBusy] = useState(false)
  const [createActionRows, setCreateActionRows] = useState<ActionDraftRow[]>([])
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null)

  const [scName, setScName] = useState('')
  const [scDesc, setScDesc] = useState('')
  const [scBusy, setScBusy] = useState(false)
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null)
  const [stepDraft, setStepDraft] = useState<Record<string, ScenarioStep[]>>({})

  const [remContact, setRemContact] = useState('')
  const [remText, setRemText] = useState('')
  const [remAt, setRemAt] = useState('')
  const [remBusy, setRemBusy] = useState(false)

  const toggleRule = async (r: MaRule) => {
    await fetch(`/api/services/${serviceId}/line-messaging/ma-rules/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !r.enabled }),
    })
    mutRules()
  }

  const deleteRule = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/ma-rules/${id}`, { method: 'DELETE' })
    mutRules()
  }

  const createRule = async (e: React.FormEvent) => {
    e.preventDefault()
    setRuleBusy(true)
    const built = buildMaActionsFromDraft(createActionRows)
    if (!built.ok) {
      alert(built.message)
      setRuleBusy(false)
      return
    }
    const priority = Number(rPriority) || 100
    let body: Record<string, unknown>
    if (ruleKind === 'keyword') {
      body = {
        rule_kind: 'keyword',
        name: rName.trim(),
        priority,
        match_type: rMatch,
        pattern: rPattern.trim(),
        reply_text: rReply.trim() || null,
        actions: built.actions,
      }
    } else if (ruleKind === 'follow') {
      body = {
        rule_kind: 'follow',
        name: rName.trim(),
        priority,
        reply_text: rReply.trim() || null,
        actions: built.actions,
      }
    } else {
      body = {
        rule_kind: 'unfollow',
        name: rName.trim(),
        priority,
        actions: built.actions,
      }
    }
    const res = await fetch(`/api/services/${serviceId}/line-messaging/ma-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setRuleBusy(false)
    if (res.ok) {
      setRName('')
      setRPattern('')
      setRReply('')
      setCreateActionRows([])
      mutRules()
    } else {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? 'ルールの作成に失敗しました')
    }
  }

  const createScenario = async (e: React.FormEvent) => {
    e.preventDefault()
    setScBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: scName.trim(),
        description: scDesc.trim() || undefined,
        enabled: true,
      }),
    })
    setScBusy(false)
    if (res.ok) {
      setScName('')
      setScDesc('')
      mutScen()
    }
  }

  const loadScenarioSteps = async (scenarioId: string) => {
    if (expandedScenario === scenarioId) {
      setExpandedScenario(null)
      return
    }
    const res = await fetch(`/api/services/${serviceId}/line-messaging/scenarios/${scenarioId}`)
    const json = await res.json()
    if (json.success && json.data?.steps) {
      const steps = (json.data.steps as { step_order: number; delay_before_seconds: number; message_text: string }[]).map(
        (s) => ({
          step_order: s.step_order,
          delay_before_seconds: s.delay_before_seconds ?? 0,
          message_text: s.message_text,
        }),
      )
      setStepDraft((d) => ({ ...d, [scenarioId]: steps.length ? steps : [{ step_order: 0, delay_before_seconds: 0, message_text: '' }] }))
    } else {
      setStepDraft((d) => ({
        ...d,
        [scenarioId]: [{ step_order: 0, delay_before_seconds: 0, message_text: '' }],
      }))
    }
    setExpandedScenario(scenarioId)
  }

  const saveSteps = async (scenarioId: string) => {
    const steps = stepDraft[scenarioId] ?? []
    const res = await fetch(`/api/services/${serviceId}/line-messaging/scenarios/${scenarioId}/steps`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? 'ステップの保存に失敗しました')
      return
    }
    alert('シナリオステップを保存しました')
  }

  const toggleScenario = async (s: Scenario) => {
    await fetch(`/api/services/${serviceId}/line-messaging/scenarios/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    })
    mutScen()
  }

  const deleteScenario = async (id: string) => {
    if (!confirm('シナリオを削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/scenarios/${id}`, { method: 'DELETE' })
    mutScen()
  }

  const createReminder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!remContact.trim()) return
    const run = remAt ? new Date(remAt).toISOString() : ''
    if (!run || Number.isNaN(Date.parse(run))) {
      alert('実行日時を入力してください')
      return
    }
    setRemBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: remContact.trim(),
        message_text: remText.trim() || 'リマインド',
        run_at: run,
      }),
    })
    setRemBusy(false)
    if (res.ok) {
      setRemContact('')
      setRemText('')
      setRemAt('')
      mutRem()
    } else {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? 'リマインダー作成に失敗しました')
    }
  }

  const cancelReminder = async (id: string) => {
    if (!confirm('このリマインダーをキャンセルしますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/reminders/${id}/cancel`, { method: 'POST' })
    mutRem()
  }

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  return (
    <div className="w-full max-w-none min-w-0">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          🤖
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">MA ルール・シナリオ・リマインダ（UI-5）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <p className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-6">
        ルールに「アクション」を追加できます（タグ付与・カスタム属性・シナリオ開始・一斉配信の予約）。一覧のルールから「アクション」で編集・保存してください。
      </p>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">MA ルール</h2>
        <form onSubmit={createRule} className="space-y-3 mb-6 border-b border-gray-100 pb-6">
          <div className="flex flex-wrap gap-2">
            <select
              value={ruleKind}
              onChange={(e) => setRuleKind(e.target.value as RuleKind)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            >
              <option value="keyword">キーワード</option>
              <option value="follow">フォロー</option>
              <option value="unfollow">アンフォロー</option>
            </select>
            <input
              value={rName}
              onChange={(e) => setRName(e.target.value)}
              placeholder="ルール名"
              className="flex-1 min-w-[160px] px-3 py-2 text-sm border border-gray-200 rounded-lg"
              required
            />
            <input
              value={rPriority}
              onChange={(e) => setRPriority(e.target.value)}
              placeholder="優先度"
              className="w-24 px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          {ruleKind === 'keyword' && (
            <>
              <div className="flex flex-wrap gap-2">
                <select
                  value={rMatch}
                  onChange={(e) => setRMatch(e.target.value as 'exact' | 'contains')}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                >
                  <option value="contains">含む</option>
                  <option value="exact">完全一致</option>
                </select>
                <input
                  value={rPattern}
                  onChange={(e) => setRPattern(e.target.value)}
                  placeholder="キーワード"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  required
                />
              </div>
              <textarea
                value={rReply}
                onChange={(e) => setRReply(e.target.value)}
                placeholder="自動返信テキスト（任意）"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </>
          )}
          {ruleKind === 'follow' && (
            <textarea
              value={rReply}
              onChange={(e) => setRReply(e.target.value)}
              placeholder="返信テキスト（任意・フォロー時に優先度の高いルールのみ一度送信）"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          )}
          <MaActionsEditor
            rows={createActionRows}
            onChange={setCreateActionRows}
            tags={tagOptions}
            definitions={definitionOptions}
            scenarios={scenarios}
            templates={templateOptions}
          />
          <button
            type="submit"
            disabled={ruleBusy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            ルールを追加
          </button>
        </form>

        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id} className="border border-gray-100 rounded-lg px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{r.name}</span>{' '}
                  <span className="text-xs text-gray-400">
                    [{r.rule_kind}] pri {r.priority}
                  </span>
                  {r.pattern && (
                    <span className="block text-xs text-gray-500 font-mono mt-0.5">{r.pattern}</span>
                  )}
                  {Array.isArray(r.actions) && r.actions.length > 0 && (
                    <span className="text-xs text-green-700 mt-1 inline-block">
                      アクション {r.actions.length} 件
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setExpandedRuleId((cur) => (cur === r.id ? null : r.id))}
                    className="text-xs text-green-700 font-medium hover:underline"
                  >
                    {expandedRuleId === r.id ? '閉じる' : 'アクション'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleRule(r)}
                    className={`text-xs px-2 py-1 rounded ${r.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {r.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button type="button" onClick={() => deleteRule(r.id)} className="text-xs text-red-500">
                    削除
                  </button>
                </div>
              </div>
              {expandedRuleId === r.id && (
                <MaRuleActionsPanel
                  serviceId={serviceId}
                  ruleId={r.id}
                  initialActions={r.actions}
                  tags={tagOptions}
                  definitions={definitionOptions}
                  scenarios={scenarios}
                  templates={templateOptions}
                  onSaved={() => mutRules()}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">シナリオ（線形ステップ）</h2>
        <form onSubmit={createScenario} className="flex flex-wrap gap-2 mb-6">
          <input
            value={scName}
            onChange={(e) => setScName(e.target.value)}
            placeholder="シナリオ名"
            className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-gray-200 rounded-lg"
            required
          />
          <input
            value={scDesc}
            onChange={(e) => setScDesc(e.target.value)}
            placeholder="説明（任意）"
            className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-gray-200 rounded-lg"
          />
          <button
            type="submit"
            disabled={scBusy}
            className="px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg"
          >
            作成
          </button>
        </form>

        <ul className="space-y-3">
          {scenarios.map((s) => (
            <li key={s.id} className="border border-gray-100 rounded-lg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{s.name}</span>{' '}
                  <span className={`text-xs ${s.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                    {s.enabled ? '有効' : '無効'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-green-600"
                    onClick={() => toggleScenario(s)}
                  >
                    切替
                  </button>
                  <button type="button" className="text-xs text-gray-600" onClick={() => loadScenarioSteps(s.id)}>
                    {expandedScenario === s.id ? '閉じる' : 'ステップ編集'}
                  </button>
                  <button type="button" className="text-xs text-red-500" onClick={() => deleteScenario(s.id)}>
                    削除
                  </button>
                </div>
              </div>
              {expandedScenario === s.id && (
                <ScenarioStepsEditor
                  steps={stepDraft[s.id] ?? [{ step_order: 0, delay_before_seconds: 0, message_text: '' }]}
                  onChange={(steps) => setStepDraft((d) => ({ ...d, [s.id]: steps }))}
                  onSave={() => saveSteps(s.id)}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-4">スケジュール済みリマインダ</h2>
        <form onSubmit={createReminder} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">contact_id（UUID）</label>
            <input
              value={remContact}
              onChange={(e) => setRemContact(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">メッセージ</label>
            <textarea
              value={remText}
              onChange={(e) => setRemText(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">実行日時（ローカル）</label>
            <input
              type="datetime-local"
              value={remAt}
              onChange={(e) => setRemAt(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              required
            />
          </div>
          <button
            type="submit"
            disabled={remBusy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg sm:col-span-2 disabled:opacity-60"
          >
            リマインダを予約
          </button>
        </form>

        <ul className="divide-y divide-gray-100">
          {reminders.map((m) => (
            <li key={m.id} className="py-2 flex justify-between gap-2 text-sm">
              <div>
                <p className="font-mono text-xs text-gray-500">{m.contact_id}</p>
                <p>{m.message_text}</p>
                <p className="text-xs text-gray-400">{new Date(m.run_at).toLocaleString('ja-JP')}</p>
              </div>
              <button type="button" onClick={() => cancelReminder(m.id)} className="text-xs text-red-500">
                キャンセル
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function ScenarioStepsEditor({
  steps,
  onChange,
  onSave,
}: {
  steps: ScenarioStep[]
  onChange: (s: ScenarioStep[]) => void
  onSave: () => void
}) {
  return (
    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
      {steps.map((st, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">順序</label>
            <input
              type="number"
              value={st.step_order}
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange(steps.map((x, j) => (j === i ? { ...x, step_order: v } : x)))
              }}
              className="w-full px-2 py-1 text-sm border rounded-lg"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="text-xs text-gray-500">遅延（秒）</label>
            <input
              type="number"
              value={st.delay_before_seconds}
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange(steps.map((x, j) => (j === i ? { ...x, delay_before_seconds: v } : x)))
              }}
              className="w-full px-2 py-1 text-sm border rounded-lg"
            />
          </div>
          <div className="sm:col-span-6">
            <label className="text-xs text-gray-500">メッセージ</label>
            <input
              value={st.message_text}
              onChange={(e) => {
                const v = e.target.value
                onChange(steps.map((x, j) => (j === i ? { ...x, message_text: v } : x)))
              }}
              className="w-full px-2 py-1 text-sm border rounded-lg"
            />
          </div>
          <div className="sm:col-span-1">
            <button
              type="button"
              className="text-xs text-red-500"
              onClick={() => onChange(steps.filter((_, j) => j !== i))}
            >
              削除
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          className="text-xs text-green-600"
          onClick={() =>
            onChange([
              ...steps,
              {
                step_order: (steps[steps.length - 1]?.step_order ?? 0) + 1,
                delay_before_seconds: 0,
                message_text: '',
              },
            ])
          }
        >
          + ステップ
        </button>
        <button type="button" className="text-sm font-medium text-white bg-green-600 px-3 py-1.5 rounded-lg" onClick={onSave}>
          ステップを保存
        </button>
      </div>
    </div>
  )
}
