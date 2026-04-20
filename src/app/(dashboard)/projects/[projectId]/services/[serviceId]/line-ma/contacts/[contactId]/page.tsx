'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

interface Contact {
  id: string
  line_user_id: string
  display_name: string | null
  picture_url: string | null
  line_status_message: string | null
  line_language: string | null
  profile_fetched_at: string | null
  is_followed: boolean | null
  lead_status: string | null
  ops_memo: string | null
  assignee_app_user_id: string | null
  first_seen_at: string | null
  last_interaction_at: string | null
}

interface Tag {
  id: string
  name: string
  color: string | null
}

interface AttrDef {
  id: string
  code: string
  label: string
  value_type: 'text' | 'number' | 'select'
  select_options: string[] | null
}

interface AttrVal {
  definition_id: string
  value_text: string
  definition: AttrDef | null
}

interface MessagingEventRow {
  id: string
  trigger_type: string
  payload: Record<string, unknown> | null
  occurred_at: string
  contact_id: string | null
  line_user_id: string | null
}

const TRIGGER_LABELS: Record<string, string> = {
  'webhook.follow': 'フォロー',
  'webhook.unfollow': 'アンフォロー',
  'webhook.message': 'テキストメッセージ',
  'webhook.postback': 'Postback',
  'ma.action_error': 'MA アクション失敗',
  'ma.reply_error': '返信送信失敗',
  'ma.postback_action_skipped': 'Postback（アクション未実行）',
  'rich_menu.link_error': 'リッチメニュー紐付け失敗',
  'rich_menu.linked': 'リッチメニュー紐付け',
}

function eventSummaryLabel(triggerType: string): string {
  return TRIGGER_LABELS[triggerType] ?? triggerType
}

function payloadPreview(payload: Record<string, unknown> | null): string | null {
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.text === 'string' && payload.text.trim()) {
    const t = payload.text.trim()
    return t.length > 120 ? `${t.slice(0, 120)}…` : t
  }
  if (typeof payload.data === 'string' && payload.data.trim()) {
    const d = payload.data.trim()
    return d.length > 100 ? `${d.slice(0, 100)}…` : d
  }
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim()
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
  if (typeof payload.reason === 'string' && payload.reason.trim()) return payload.reason.trim()
  return null
}

export default function LineMaContactDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string; contactId: string }>
}) {
  const { projectId, serviceId, contactId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const detailUrl = `/api/services/${serviceId}/line-messaging/contacts/${contactId}`
  const eventsUrl = `${detailUrl}/events?limit=50`
  const { data: detailResp, mutate, isLoading: detailLoading } = useSWR(
    service?.service_type === 'line' ? detailUrl : null,
    fetcher,
  )
  const { data: eventsResp, mutate: mutateEvents, isLoading: eventsLoading } = useSWR<{
    success?: boolean
    data?: MessagingEventRow[]
    error?: string
  }>(service?.service_type === 'line' ? eventsUrl : null, fetcher)

  const contact: Contact | undefined = detailResp?.data?.contact
  const initialTags: Tag[] = detailResp?.data?.tags ?? []
  const attrVals: AttrVal[] = detailResp?.data?.attribute_values ?? []

  const { data: allTagsResp } = useSWR<{ success: boolean; data: Tag[] }>(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/tags` : null,
    fetcher,
  )
  const allTags = allTagsResp?.data ?? []

  const { data: defsResp } = useSWR<{ success: boolean; data: AttrDef[] }>(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/attribute-definitions` : null,
    fetcher,
  )
  const definitions = defsResp?.data ?? []

  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [leadStatus, setLeadStatus] = useState('')
  const [opsMemo, setOpsMemo] = useState('')
  const [assignee, setAssignee] = useState('')
  const [attrDraft, setAttrDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!contact) return
    setLeadStatus(contact.lead_status ?? '')
    setOpsMemo(contact.ops_memo ?? '')
    setAssignee(contact.assignee_app_user_id ?? '')
  }, [contact?.id, contact?.lead_status, contact?.ops_memo, contact?.assignee_app_user_id])

  useEffect(() => {
    setSelectedTagIds(new Set(initialTags.map((t) => t.id)))
  }, [initialTags])

  useEffect(() => {
    const m: Record<string, string> = {}
    for (const v of attrVals) {
      m[v.definition_id] = v.value_text ?? ''
    }
    setAttrDraft(m)
  }, [contactId, attrVals])

  const [savingProfile, setSavingProfile] = useState(false)
  const [savingTags, setSavingTags] = useState(false)
  const [savingAttr, setSavingAttr] = useState(false)
  const [syncProfileBusy, setSyncProfileBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    setMsg(null)
    const res = await fetch(detailUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_status: leadStatus.trim() || null,
        ops_memo: opsMemo.trim() || null,
        assignee_app_user_id: assignee.trim() ? assignee.trim() : null,
      }),
    })
    const json = await res.json()
    setSavingProfile(false)
    if (!res.ok) {
      setMsg(json.error ?? '保存に失敗しました')
      return
    }
    setMsg('プロフィールを保存しました')
    mutate()
  }

  const saveTags = async () => {
    setSavingTags(true)
    setMsg(null)
    const res = await fetch(`${detailUrl}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_ids: [...selectedTagIds] }),
    })
    const json = await res.json()
    setSavingTags(false)
    if (!res.ok) {
      setMsg(json.error ?? 'タグの保存に失敗しました')
      return
    }
    setMsg('タグを保存しました')
    mutate()
  }

  const saveAttributes = async () => {
    setSavingAttr(true)
    setMsg(null)
    const values = definitions
      .map((d) => {
        const raw = attrDraft[d.id]
        if (raw === undefined || raw === '') return null
        return { definition_id: d.id, value_text: raw }
      })
      .filter((v): v is { definition_id: string; value_text: string } => v !== null)

    const res = await fetch(`${detailUrl}/attributes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    })
    const json = await res.json()
    setSavingAttr(false)
    if (!res.ok) {
      setMsg(json.error ?? '属性の保存に失敗しました')
      return
    }
    setMsg('属性を保存しました')
    mutate()
  }

  const sortedTags = useMemo(() => [...allTags].sort((a, b) => a.name.localeCompare(b.name)), [allTags])

  const syncLineProfile = async () => {
    setSyncProfileBusy(true)
    setMsg(null)
    const res = await fetch(`${detailUrl}/sync-profile`, { method: 'POST' })
    const json = await res.json()
    setSyncProfileBusy(false)
    if (!res.ok) {
      setMsg(json.message ?? json.error ?? 'プロフィールの取得に失敗しました')
      return
    }
    setMsg('LINE プロフィールを反映しました')
    mutate()
  }

  if (service && service.service_type !== 'line') {
    return (
      <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
    )
  }

  if (detailResp && (detailResp as { error?: string }).error === 'not_found') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-gray-600">コンタクトが見つかりません。</p>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/line-ma/contacts`}
          className="text-green-600 text-sm mt-2 inline-block"
        >
          一覧に戻る
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <LineMaBreadcrumb
        projectId={projectId}
        serviceId={serviceId}
        projectName={service?.project.project_name ?? ''}
        serviceName={service?.service_name ?? ''}
        extra="コンタクト詳細"
      />

      <div className="mb-4">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/line-ma/contacts`}
          className="text-xs text-green-600 hover:underline"
        >
          ← 一覧
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          👤
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{contact?.display_name ?? 'コンタクト'}</h1>
          <p className="text-sm text-gray-400 font-mono">{contact?.line_user_id}</p>
        </div>
      </div>

      {msg && <p className="text-sm text-gray-700 mb-4 bg-green-50 border border-green-100 rounded-lg px-3 py-2">{msg}</p>}

      {detailLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : !contact ? (
        <p className="text-sm text-gray-500">読み込めませんでした。</p>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <h2 className="font-bold text-gray-900">基本情報</h2>
              <button
                type="button"
                onClick={syncLineProfile}
                disabled={syncProfileBusy}
                className="px-3 py-1.5 text-xs font-medium text-green-800 border border-green-300 rounded-lg hover:bg-green-50 disabled:opacity-50"
              >
                {syncProfileBusy ? '取得中...' : 'LINE プロフィールを再取得'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Webhook 受信時（フォロー・メッセージ・postback）にも自動でプロフィールを取得します。手動は上のボタンから。
            </p>
            <div className="flex flex-wrap gap-6 mb-4">
              {contact.picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.picture_url}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover border border-gray-200"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-2xl text-gray-300">
                  ?
                </div>
              )}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm flex-1 min-w-0">
                <div>
                  <dt className="text-xs text-gray-400">表示名（LINE）</dt>
                  <dd className="text-gray-900 font-medium">{contact.display_name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">友だち状態</dt>
                  <dd>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        contact.is_followed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {contact.is_followed ? 'フォロー中' : '未フォロー'}
                    </span>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-gray-400">ステータスメッセージ</dt>
                  <dd className="text-gray-800 whitespace-pre-wrap break-words">
                    {contact.line_status_message ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">言語（LINE）</dt>
                  <dd className="text-gray-800 font-mono">{contact.line_language ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">プロフィール最終取得</dt>
                  <dd className="text-gray-800">
                    {contact.profile_fetched_at
                      ? new Date(contact.profile_fetched_at).toLocaleString('ja-JP')
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">初回接触</dt>
                  <dd className="text-gray-800">
                    {contact.first_seen_at ? new Date(contact.first_seen_at).toLocaleString('ja-JP') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">最終接触</dt>
                  <dd className="text-gray-800">
                    {contact.last_interaction_at
                      ? new Date(contact.last_interaction_at).toLocaleString('ja-JP')
                      : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="font-bold text-gray-900">行動履歴（MA イベント）</h2>
              <button
                type="button"
                onClick={() => void mutateEvents()}
                className="text-xs text-green-700 border border-green-200 rounded-lg px-2 py-1 hover:bg-green-50"
              >
                再読み込み
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Webhook・MA・リッチメニュー連携などで記録されたイベントです。古いデータは contact_id が無い場合も line_user_id で表示します。
            </p>
            {eventsLoading ? (
              <p className="text-sm text-gray-500">読み込み中...</p>
            ) : eventsResp?.error ? (
              <p className="text-sm text-red-600">{eventsResp.error}</p>
            ) : !(eventsResp?.data?.length) ? (
              <p className="text-sm text-gray-500">まだイベントがありません。</p>
            ) : (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                {eventsResp.data.map((ev) => {
                  const preview = payloadPreview(ev.payload)
                  const linked = ev.contact_id ? 'contact' : 'user_id'
                  return (
                    <li key={ev.id} className="px-3 py-2.5 text-sm bg-white hover:bg-gray-50/80">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-gray-900">{eventSummaryLabel(ev.trigger_type)}</span>
                        <time className="text-xs text-gray-400 tabular-nums shrink-0">
                          {new Date(ev.occurred_at).toLocaleString('ja-JP')}
                        </time>
                      </div>
                      {preview && (
                        <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap break-words font-mono">
                          {preview}
                        </p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1">
                        <span className="font-mono">{ev.trigger_type}</span>
                        {linked === 'user_id' ? ' · contact_id なし（ユーザーID照合）' : ''}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <form onSubmit={saveProfile} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-900">オペレーション</h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">リードステータス</label>
              <input
                type="text"
                value={leadStatus}
                onChange={(e) => setLeadStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">メモ</label>
              <textarea
                value={opsMemo}
                onChange={(e) => setOpsMemo(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">担当者（app user UUID・任意）</label>
              <input
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60"
            >
              {savingProfile ? '保存中...' : '保存'}
            </button>
          </form>

          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">タグ</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {sortedTags.map((t) => (
                <label
                  key={t.id}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${
                    selectedTagIds.has(t.id)
                      ? 'border-green-500 bg-green-50 text-green-900'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={selectedTagIds.has(t.id)}
                    onChange={() => toggleTag(t.id)}
                  />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
            {sortedTags.length === 0 && <p className="text-xs text-gray-400 mb-4">タグがありません。CRM 画面で作成してください。</p>}
            <button
              type="button"
              onClick={saveTags}
              disabled={savingTags}
              className="px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 disabled:opacity-60"
            >
              {savingTags ? '保存中...' : 'タグを保存'}
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">カスタム属性</h2>
            {definitions.length === 0 ? (
              <p className="text-xs text-gray-400">属性定義がありません。CRM 画面で追加してください。</p>
            ) : (
              <div className="space-y-4">
                {definitions.map((d) => (
                  <div key={d.id}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {d.label}{' '}
                      <span className="text-gray-400 font-normal">({d.code})</span>
                    </label>
                    {d.value_type === 'select' ? (
                      <select
                        value={attrDraft[d.id] ?? ''}
                        onChange={(e) => setAttrDraft((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                      >
                        <option value="">（未設定）</option>
                        {(d.select_options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={d.value_type === 'number' ? 'number' : 'text'}
                        value={attrDraft[d.id] ?? ''}
                        onChange={(e) => setAttrDraft((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                      />
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={saveAttributes}
                  disabled={savingAttr}
                  className="px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 disabled:opacity-60"
                >
                  {savingAttr ? '保存中...' : '属性を保存'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
