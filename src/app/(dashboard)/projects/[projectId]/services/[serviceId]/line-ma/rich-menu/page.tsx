'use client'

import { use, useMemo, useState } from 'react'
import useSWR from 'swr'

import {
  buildMaActionsFromDraft,
  MaActionsEditor,
  parseActionsToDraft,
} from '../ma/ma-actions-editor'
import type { ActionDraftRow } from '../ma/ma-actions-editor'

import { LineMaBreadcrumb, LineMaNav } from '../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

const DEFAULT_AREAS_EXAMPLE = `[
  {
    "bounds": { "x": 0, "y": 0, "width": 1250, "height": 843 },
    "action": { "type": "message", "label": "お問い合わせ", "text": "お問い合わせ" }
  }
]`

export default function LineMaRichMenuPage({
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

  const { data: menusResp, mutate: mutMenus } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/rich-menus` : null,
    fetcher,
  )
  const menus: Record<string, unknown>[] = menusResp?.data ?? []

  const { data: rulesResp, mutate: mutRules } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/rich-menu-rules` : null,
    fetcher,
  )
  const rules: Record<string, unknown>[] = rulesResp?.data ?? []

  const { data: bindingsResp, mutate: mutBind } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/postback-bindings` : null,
    fetcher,
  )
  const bindings: { id: string; data_key: string; actions: unknown }[] = bindingsResp?.data ?? []

  const { data: segResp } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/segments` : null,
    fetcher,
  )
  const segments: { id: string; name: string }[] = segResp?.data ?? []

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

  const { data: scenResp } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/scenarios` : null,
    fetcher,
  )
  const scenarios: { id: string; name: string }[] = scenResp?.data ?? []

  const { data: tplResp } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/templates` : null,
    fetcher,
  )
  const templateOptions: { id: string; name: string }[] = tplResp?.data ?? []

  const [rmName, setRmName] = useState('メニューA')
  const [rmChatBar, setRmChatBar] = useState('メニュー')
  const [rmSelected, setRmSelected] = useState(false)
  const [rmAreasJson, setRmAreasJson] = useState(DEFAULT_AREAS_EXAMPLE)
  const [rmSizeJson, setRmSizeJson] = useState('{"width":2500,"height":1686}')
  const [rmBusy, setRmBusy] = useState(false)

  const [rulePri, setRulePri] = useState('100')
  const [ruleMenuId, setRuleMenuId] = useState('')
  const [ruleSegId, setRuleSegId] = useState('')
  const [ruleBusy, setRuleBusy] = useState(false)

  const [pbKey, setPbKey] = useState('')
  const [pbRows, setPbRows] = useState<ActionDraftRow[]>([])
  const [pbBusy, setPbBusy] = useState(false)

  const [linkUserRm, setLinkUserRm] = useState('')
  const [linkUserId, setLinkUserId] = useState('')
  const [applyUserId, setApplyUserId] = useState('')

  const menuOptions = useMemo(
    () =>
      menus.map((m) => ({
        id: String(m.id),
        label: String(m.name ?? m.id),
        lineId: m.line_rich_menu_id ? String(m.line_rich_menu_id) : '',
      })),
    [menus],
  )

  const createRichMenu = async (e: React.FormEvent) => {
    e.preventDefault()
    let areas: unknown
    try {
      areas = JSON.parse(rmAreasJson)
    } catch {
      alert('areas の JSON が不正です')
      return
    }
    if (!Array.isArray(areas) || areas.length === 0) {
      alert('areas は空でない JSON 配列にしてください')
      return
    }
    let size: { width: number; height: number } | undefined
    if (rmSizeJson.trim()) {
      try {
        size = JSON.parse(rmSizeJson) as { width: number; height: number }
      } catch {
        alert('size の JSON が不正です')
        return
      }
    }
    setRmBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/rich-menus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: rmName.trim(),
        chat_bar_text: rmChatBar.trim() || 'メニュー',
        selected: rmSelected,
        areas,
        ...(size ? { size } : {}),
      }),
    })
    const j = await res.json().catch(() => ({}))
    setRmBusy(false)
    if (!res.ok) {
      alert(j.message ?? j.error ?? '作成に失敗しました')
      return
    }
    mutMenus()
  }

  const uploadImage = async (menuId: string, file: File | null) => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/rich-menus/${menuId}/image`, {
      method: 'POST',
      body: fd,
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) alert(j.message ?? j.error ?? '画像アップロードに失敗しました')
    else alert('画像をアップロードしました')
  }

  const deleteMenu = async (menuId: string) => {
    if (!confirm('LINE 上のリッチメニューも削除します。よろしいですか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/rich-menus/${menuId}`, { method: 'DELETE' })
    mutMenus()
    mutRules()
  }

  const createRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ruleMenuId) {
      alert('リッチメニューを選択してください')
      return
    }
    setRuleBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/rich-menu-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priority: Number(rulePri) || 100,
        rich_menu_id: ruleMenuId,
        segment_id: ruleSegId.trim() || null,
        enabled: true,
      }),
    })
    setRuleBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? 'ルール作成に失敗しました')
      return
    }
    mutRules()
  }

  const deleteRule = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/rich-menu-rules/${id}`, { method: 'DELETE' })
    mutRules()
  }

  const savePostback = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pbKey.trim()) {
      alert('data_key を入力してください（postback の data と一致）')
      return
    }
    const built = buildMaActionsFromDraft(pbRows)
    if (!built.ok) {
      alert(built.message)
      return
    }
    setPbBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/postback-bindings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_key: pbKey.trim(), actions: built.actions }),
    })
    setPbBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '保存に失敗しました')
      return
    }
    setPbKey('')
    setPbRows([])
    mutBind()
  }

  const deleteBinding = async (id: string) => {
    if (!confirm('このバインディングを削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/postback-bindings/${id}`, { method: 'DELETE' })
    mutBind()
  }

  const linkUser = async () => {
    if (!linkUserRm || !linkUserId.trim()) return
    const res = await fetch(`/api/services/${serviceId}/line-messaging/rich-menus/${linkUserRm}/link-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_user_id: linkUserId.trim() }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) alert(j.error ?? j.message ?? 'リンクに失敗しました')
    else alert('ユーザにリッチメニューをリンクしました')
  }

  const applyRules = async () => {
    if (!applyUserId.trim()) return
    const res = await fetch(`/api/services/${serviceId}/line-messaging/rich-menus/apply-contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_user_id: applyUserId.trim() }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) alert(j.error ?? '適用に失敗しました')
    else alert('セグメントルールに従いリッチメニューを適用しました')
  }

  const loadBinding = (b: { data_key: string; actions: unknown }) => {
    setPbKey(b.data_key)
    setPbRows(parseActionsToDraft(b.actions))
  }

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <LineMaBreadcrumb
        projectId={projectId}
        serviceId={serviceId}
        projectName={service?.project.project_name ?? ''}
        serviceName={service?.service_name ?? ''}
        extra="リッチメニュー・postback"
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          📱
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">リッチメニュー・postback（UI-7）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <LineMaNav projectId={projectId} serviceId={serviceId} />

      <p className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-6">
        事前に「接続」で Channel access token を保存してください。エリア定義は{' '}
        <a
          href="https://developers.line.biz/ja/reference/messaging-api/#create-rich-menu"
          className="text-green-700 underline"
          target="_blank"
          rel="noreferrer"
        >
          LINE のリッチメニュー形式
        </a>
        に従った JSON 配列を入力します。
      </p>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">リッチメニューを作成（LINE API 連携）</h2>
        <form onSubmit={createRichMenu} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">名前</label>
              <input
                value={rmName}
                onChange={(e) => setRmName(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">チャットバー表示（最大14文字）</label>
              <input
                value={rmChatBar}
                onChange={(e) => setRmChatBar(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rmSelected} onChange={(e) => setRmSelected(e.target.checked)} />
            デフォルト表示（selected）
          </label>
          <div>
            <label className="text-xs text-gray-500">サイズ（省略時 2500×1686）</label>
            <input
              value={rmSizeJson}
              onChange={(e) => setRmSizeJson(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border rounded-lg"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">areas（JSON 配列）</label>
            <textarea
              value={rmAreasJson}
              onChange={(e) => setRmAreasJson(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 text-xs font-mono border rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={rmBusy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            {rmBusy ? '作成中...' : '作成'}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">一覧・画像・削除</h2>
        {menus.length === 0 ? (
          <p className="text-sm text-gray-400">リッチメニューがありません</p>
        ) : (
          <ul className="space-y-4">
            {menus.map((m) => {
              const id = String(m.id)
              return (
                <li key={id} className="border border-gray-100 rounded-lg p-4 text-sm">
                  <p className="font-medium">{String(m.name)}</p>
                  <p className="text-xs text-gray-400 font-mono mt-1">
                    line_rich_menu_id: {String(m.line_rich_menu_id ?? '—')}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3 items-center">
                    <label className="text-xs text-gray-500">
                      画像（JPEG/PNG）
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        className="block text-xs mt-1"
                        onChange={(e) => uploadImage(id, e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteMenu(id)}
                      className="text-xs text-red-600"
                    >
                      削除
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-2">ユーザへの適用</h2>
        <p className="text-xs text-gray-500 mb-4">
          「ルールに従う」はセグメント優先度に基づきメニューをリンクします。特定メニューを強制する場合は直接リンクを使います。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs text-gray-500">ルールに従って適用（line_user_id）</label>
            <input
              value={applyUserId}
              onChange={(e) => setApplyUserId(e.target.value)}
              placeholder="U..."
              className="w-full px-3 py-2 text-sm border rounded-lg font-mono mt-1"
            />
            <button
              type="button"
              onClick={applyRules}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-green-800 border border-green-300 rounded-lg"
            >
              ルールで適用
            </button>
          </div>
          <div>
            <label className="text-xs text-gray-500">特定メニューをリンク</label>
            <select
              value={linkUserRm}
              onChange={(e) => setLinkUserRm(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-white mt-1"
            >
              <option value="">選択...</option>
              {menuOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              value={linkUserId}
              onChange={(e) => setLinkUserId(e.target.value)}
              placeholder="line_user_id"
              className="w-full px-3 py-2 text-sm border rounded-lg font-mono mt-2"
            />
            <button
              type="button"
              onClick={linkUser}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-gray-800 border border-gray-300 rounded-lg"
            >
              このメニューをリンク
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">表示ルール（優先度の小さい順）</h2>
        <form onSubmit={createRule} className="flex flex-wrap gap-2 items-end mb-4">
          <div>
            <label className="text-xs text-gray-500">優先度</label>
            <input
              value={rulePri}
              onChange={(e) => setRulePri(e.target.value)}
              className="w-24 px-2 py-1.5 text-sm border rounded-lg mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">リッチメニュー</label>
            <select
              value={ruleMenuId}
              onChange={(e) => setRuleMenuId(e.target.value)}
              className="block min-w-[180px] px-2 py-1.5 text-sm border rounded-lg bg-white mt-1"
            >
              <option value="">選択...</option>
              {menuOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">セグメント（空＝全員向け）</label>
            <select
              value={ruleSegId}
              onChange={(e) => setRuleSegId(e.target.value)}
              className="block min-w-[180px] px-2 py-1.5 text-sm border rounded-lg bg-white mt-1"
            >
              <option value="">（なし）</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={ruleBusy}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-60"
          >
            追加
          </button>
        </form>
        <ul className="divide-y divide-gray-100">
          {rules.map((r) => (
            <li key={String(r.id)} className="py-2 flex justify-between gap-2 text-sm">
              <span>
                pri {String(r.priority)} — menu {String(r.rich_menu_id).slice(0, 8)}…
                {r.segment_id ? ` / seg ${String(r.segment_id).slice(0, 8)}…` : ' / 全体'}
              </span>
              <button
                type="button"
                className="text-xs text-red-500"
                onClick={() => deleteRule(String(r.id))}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-2">postback バインディング</h2>
        <p className="text-xs text-gray-500 mb-4">
          リッチメニューの postback の data と一致するキーに対し、MA アクションを実行します。
        </p>
        <form onSubmit={savePostback} className="space-y-4 mb-6">
          <div>
            <label className="text-xs text-gray-500">data_key</label>
            <input
              value={pbKey}
              onChange={(e) => setPbKey(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg font-mono"
              placeholder="action=browse"
            />
          </div>
          <MaActionsEditor
            rows={pbRows}
            onChange={setPbRows}
            tags={tagOptions}
            definitions={definitionOptions}
            scenarios={scenarios}
            templates={templateOptions}
          />
          <button
            type="submit"
            disabled={pbBusy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            {pbBusy ? '保存中...' : '保存（upsert）'}
          </button>
        </form>
        <ul className="space-y-2">
          {bindings.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap justify-between gap-2 border border-gray-50 rounded p-2 text-sm"
            >
              <span className="font-mono text-xs">{b.data_key}</span>
              <div className="flex gap-2">
                <button type="button" className="text-xs text-green-700" onClick={() => loadBinding(b)}>
                  編集に読込
                </button>
                <button type="button" className="text-xs text-red-500" onClick={() => deleteBinding(b.id)}>
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
