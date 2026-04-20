'use client'

import { useEffect, useMemo, useState } from 'react'

import type { MaAction } from '@/lib/line/ma-action-types'
import { MaActionsSchema } from '@/lib/line/ma-action-types'

export type ActionDraftRow =
  | { key: string; type: 'add_tag'; tag_id: string }
  | { key: string; type: 'set_attribute'; definition_id: string; value_text: string }
  | { key: string; type: 'start_scenario'; scenario_id: string }
  | {
      key: string
      type: 'enqueue_broadcast'
      template_id: string
      scheduled_local: string
    }

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function parseActionsToDraft(raw: unknown): ActionDraftRow[] {
  const parsed = MaActionsSchema.safeParse(raw)
  if (!parsed.success) return []
  return parsed.data.map((a) => {
    const key = newKey()
    switch (a.type) {
      case 'add_tag':
        return { key, type: 'add_tag', tag_id: a.tag_id }
      case 'set_attribute':
        return { key, type: 'set_attribute', definition_id: a.definition_id, value_text: a.value_text }
      case 'start_scenario':
        return { key, type: 'start_scenario', scenario_id: a.scenario_id }
      case 'enqueue_broadcast': {
        let scheduled_local = ''
        if (a.scheduled_at) {
          const d = new Date(a.scheduled_at)
          if (!Number.isNaN(d.getTime())) {
            const pad = (n: number) => String(n).padStart(2, '0')
            scheduled_local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
          }
        }
        return { key, type: 'enqueue_broadcast', template_id: a.template_id, scheduled_local }
      }
    }
  })
}

export function buildMaActionsFromDraft(rows: ActionDraftRow[]): { ok: true; actions: MaAction[] } | { ok: false; message: string } {
  const out: MaAction[] = []
  for (const row of rows) {
    switch (row.type) {
      case 'add_tag':
        if (!row.tag_id.trim()) continue
        out.push({ type: 'add_tag', tag_id: row.tag_id.trim() })
        break
      case 'set_attribute':
        if (!row.definition_id.trim() || !row.value_text.trim()) continue
        out.push({
          type: 'set_attribute',
          definition_id: row.definition_id.trim(),
          value_text: row.value_text.trim(),
        })
        break
      case 'start_scenario':
        if (!row.scenario_id.trim()) continue
        out.push({ type: 'start_scenario', scenario_id: row.scenario_id.trim() })
        break
      case 'enqueue_broadcast':
        if (!row.template_id.trim()) continue
        {
          let scheduled_at: string | undefined
          if (row.scheduled_local.trim()) {
            const ms = Date.parse(row.scheduled_local)
            if (Number.isNaN(ms)) {
              return { ok: false, message: '一斉配信の予約日時が不正です' }
            }
            scheduled_at = new Date(ms).toISOString()
          }
          out.push({
            type: 'enqueue_broadcast',
            template_id: row.template_id.trim(),
            ...(scheduled_at ? { scheduled_at } : {}),
          })
        }
        break
    }
  }
  const validated = MaActionsSchema.safeParse(out)
  if (!validated.success) {
    return { ok: false, message: 'アクションの内容を確認してください' }
  }
  return { ok: true, actions: validated.data }
}

interface TagOpt {
  id: string
  name: string
}

interface AttrDefOpt {
  id: string
  label: string
  code: string
  value_type: string
  select_options: string[] | null
}

interface ScenarioOpt {
  id: string
  name: string
}

interface TemplateOpt {
  id: string
  name: string
}

export function MaActionsEditor({
  rows,
  onChange,
  tags,
  definitions,
  scenarios,
  templates,
}: {
  rows: ActionDraftRow[]
  onChange: (rows: ActionDraftRow[]) => void
  tags: TagOpt[]
  definitions: AttrDefOpt[]
  scenarios: ScenarioOpt[]
  templates: TemplateOpt[]
}) {
  const defById = useMemo(() => new Map(definitions.map((d) => [d.id, d])), [definitions])

  const updateRow = (key: string, patch: Partial<ActionDraftRow> | ActionDraftRow) => {
    onChange(
      rows.map((r) => {
        if (r.key !== key) return r
        if ('type' in patch && patch.type !== undefined && patch.type !== r.type) {
          const t = patch.type as ActionDraftRow['type']
          if (t === 'add_tag') return { key: r.key, type: 'add_tag', tag_id: '' }
          if (t === 'set_attribute') return { key: r.key, type: 'set_attribute', definition_id: '', value_text: '' }
          if (t === 'start_scenario') return { key: r.key, type: 'start_scenario', scenario_id: '' }
          return { key: r.key, type: 'enqueue_broadcast', template_id: '', scheduled_local: '' }
        }
        return { ...r, ...patch } as ActionDraftRow
      }),
    )
  }

  const addRow = () => {
    onChange([...rows, { key: newKey(), type: 'add_tag', tag_id: '' }])
  }

  const removeRow = (key: string) => {
    onChange(rows.filter((r) => r.key !== key))
  }

  return (
    <div className="space-y-3 border border-gray-100 rounded-lg p-3 bg-gray-50/80">
      <p className="text-xs font-medium text-gray-700">発火後に実行するアクション（任意・複数可）</p>
      {rows.length === 0 && (
        <p className="text-xs text-gray-400">未設定です。「アクションを追加」で追加できます。</p>
      )}
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-2 border-b border-gray-100 pb-3 last:border-0 last:pb-0">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={row.type}
              onChange={(e) => {
                const t = e.target.value as ActionDraftRow['type']
                updateRow(row.key, { type: t } as Partial<ActionDraftRow>)
              }}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
            >
              <option value="add_tag">タグを付与</option>
              <option value="set_attribute">属性を設定</option>
              <option value="start_scenario">シナリオを開始</option>
              <option value="enqueue_broadcast">一斉配信ジョブを予約</option>
            </select>
            <button type="button" className="text-xs text-red-500" onClick={() => removeRow(row.key)}>
              この行を削除
            </button>
          </div>

          {row.type === 'add_tag' && (
            <select
              value={row.tag_id}
              onChange={(e) => updateRow(row.key, { tag_id: e.target.value })}
              className="w-full max-w-md text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
            >
              <option value="">タグを選択...</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          {row.type === 'set_attribute' && (
            <div className="space-y-2 max-w-xl">
              <select
                value={row.definition_id}
                onChange={(e) => updateRow(row.key, { definition_id: e.target.value, value_text: '' })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">属性定義を選択...</option>
                {definitions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.code}) — {d.value_type}
                  </option>
                ))}
              </select>
              {row.definition_id && defById.get(row.definition_id)?.value_type === 'select' ? (
                <select
                  value={row.value_text}
                  onChange={(e) => updateRow(row.key, { value_text: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="">値を選択...</option>
                  {(defById.get(row.definition_id)?.select_options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={row.value_text}
                  onChange={(e) => updateRow(row.key, { value_text: e.target.value })}
                  placeholder="値"
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                />
              )}
            </div>
          )}

          {row.type === 'start_scenario' && (
            <select
              value={row.scenario_id}
              onChange={(e) => updateRow(row.key, { scenario_id: e.target.value })}
              className="w-full max-w-md text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
            >
              <option value="">シナリオを選択...</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          {row.type === 'enqueue_broadcast' && (
            <div className="space-y-2 max-w-xl">
              <select
                value={row.template_id}
                onChange={(e) => updateRow(row.key, { template_id: e.target.value })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">テンプレートを選択...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <div>
                <label className="text-xs text-gray-500">予約日時（空なら即時扱い）</label>
                <input
                  type="datetime-local"
                  value={row.scheduled_local}
                  onChange={(e) => updateRow(row.key, { scheduled_local: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mt-0.5"
                />
              </div>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="text-xs font-medium text-green-700 border border-green-300 rounded-lg px-3 py-1.5 hover:bg-green-50"
      >
        + アクションを追加
      </button>
    </div>
  )
}

/** ルール編集パネル用: 保存・キャンセル付き */
export function MaRuleActionsPanel({
  serviceId,
  ruleId,
  initialActions,
  tags,
  definitions,
  scenarios,
  templates,
  onSaved,
}: {
  serviceId: string
  ruleId: string
  initialActions: unknown
  tags: TagOpt[]
  definitions: AttrDefOpt[]
  scenarios: ScenarioOpt[]
  templates: TemplateOpt[]
  onSaved: () => void
}) {
  const [rows, setRows] = useState<ActionDraftRow[]>(() => {
    const next = parseActionsToDraft(initialActions)
    return next.length ? next : []
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const next = parseActionsToDraft(initialActions)
    setRows(next.length ? next : [])
  }, [ruleId, initialActions])

  const save = async () => {
    const built = buildMaActionsFromDraft(rows)
    if (!built.ok) {
      alert(built.message)
      return
    }
    setSaving(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/ma-rules/${ruleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: built.actions }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      alert(json.error ?? '保存に失敗しました')
      return
    }
    onSaved()
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      <MaActionsEditor
        rows={rows}
        onChange={setRows}
        tags={tags}
        definitions={definitions}
        scenarios={scenarios}
        templates={templates}
      />
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="text-sm font-medium text-white bg-green-600 px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {saving ? '保存中...' : 'アクションを保存'}
      </button>
    </div>
  )
}
