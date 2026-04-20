'use client'

import { use, useMemo, useState } from 'react'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
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
  value_type: string
  select_options: string[] | null
}

interface Segment {
  id: string
  name: string
  definition: Record<string, unknown>
}

export default function LineMaCrmPage({
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

  const { data: tagsResp, mutate: mutTags } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/tags` : null,
    fetcher,
  )
  const tags: Tag[] = tagsResp?.data ?? []

  const { data: defsResp, mutate: mutDefs } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/attribute-definitions` : null,
    fetcher,
  )
  const defs: AttrDef[] = defsResp?.data ?? []

  const { data: segResp, mutate: mutSeg } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/segments` : null,
    fetcher,
  )
  const segments: Segment[] = segResp?.data ?? []

  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('')
  const [tagBusy, setTagBusy] = useState(false)

  const [defCode, setDefCode] = useState('')
  const [defLabel, setDefLabel] = useState('')
  const [defType, setDefType] = useState<'text' | 'number' | 'select'>('text')
  const [defOptions, setDefOptions] = useState('')
  const [defBusy, setDefBusy] = useState(false)

  const [segName, setSegName] = useState('')
  const [followStatus, setFollowStatus] = useState<'followed_only' | 'all'>('followed_only')
  const [tagAny, setTagAny] = useState<Set<string>>(new Set())
  const [tagAll, setTagAll] = useState<Set<string>>(new Set())
  const [tagNone, setTagNone] = useState<Set<string>>(new Set())
  const [attrRows, setAttrRows] = useState<
    { definition_id: string; op: string; value: string }[]
  >([])
  const [segBusy, setSegBusy] = useState(false)

  const [previewSegId, setPreviewSegId] = useState<string | null>(null)
  const previewUrl =
    previewSegId && service?.service_type === 'line'
      ? `/api/services/${serviceId}/line-messaging/segments/${previewSegId}/preview`
      : null
  const { data: previewResp } = useSWR(previewUrl, fetcher)

  const toggleInSet = (set: Set<string>, id: string) => {
    const n = new Set(set)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }

  const createTag = async (e: React.FormEvent) => {
    e.preventDefault()
    setTagBusy(true)
    await fetch(`/api/services/${serviceId}/line-messaging/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tagName.trim(), color: tagColor.trim() || undefined }),
    })
    setTagBusy(false)
    setTagName('')
    setTagColor('')
    mutTags()
  }

  const deleteTag = async (id: string) => {
    if (!confirm('このタグを削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/tags/${id}`, { method: 'DELETE' })
    mutTags()
  }

  const createDef = async (e: React.FormEvent) => {
    e.preventDefault()
    setDefBusy(true)
    const opts =
      defType === 'select'
        ? defOptions
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
    await fetch(`/api/services/${serviceId}/line-messaging/attribute-definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: defCode.trim(),
        label: defLabel.trim(),
        value_type: defType,
        select_options: opts,
      }),
    })
    setDefBusy(false)
    setDefCode('')
    setDefLabel('')
    setDefOptions('')
    mutDefs()
  }

  const deleteDef = async (id: string) => {
    if (!confirm('この属性定義を削除しますか？関連する値も失われる可能性があります。')) return
    await fetch(`/api/services/${serviceId}/line-messaging/attribute-definitions/${id}`, {
      method: 'DELETE',
    })
    mutDefs()
  }

  const buildDefinition = () => {
    const definition: Record<string, unknown> = { follow_status: followStatus }
    if (tagAny.size) definition.tag_ids_any = [...tagAny]
    if (tagAll.size) definition.tag_ids_all = [...tagAll]
    if (tagNone.size) definition.tag_ids_none = [...tagNone]
    const filters = attrRows.filter((r) => r.definition_id && r.value.trim())
    if (filters.length) {
      definition.attribute_filters = filters.map((r) => ({
        definition_id: r.definition_id,
        op: r.op as 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte',
        value: r.value.trim(),
      }))
    }
    return definition
  }

  const createSegment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!segName.trim()) return
    setSegBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: segName.trim(), definition: buildDefinition() }),
    })
    setSegBusy(false)
    if (res.ok) {
      setSegName('')
      setTagAny(new Set())
      setTagAll(new Set())
      setTagNone(new Set())
      setAttrRows([])
      mutSeg()
    } else {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? 'セグメントの作成に失敗しました')
    }
  }

  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.name.localeCompare(b.name)), [tags])

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  return (
    <div className="p-6 w-full max-w-none">
      <LineMaBreadcrumb
        projectId={projectId}
        serviceId={serviceId}
        projectName={service?.project.project_name ?? ''}
        serviceName={service?.service_name ?? ''}
        extra="タグ・属性・セグメント"
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          🏷️
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">タグ・属性・セグメント（UI-3）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      {/* Tags */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">タグ</h2>
        <form onSubmit={createTag} className="flex flex-wrap gap-2 items-end mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">名前</label>
            <input
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg min-w-[180px]"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">色（任意）</label>
            <input
              value={tagColor}
              onChange={(e) => setTagColor(e.target.value)}
              placeholder="#22c55e"
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-28"
            />
          </div>
          <button
            type="submit"
            disabled={tagBusy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            追加
          </button>
        </form>
        <ul className="divide-y divide-gray-100">
          {sortedTags.map((t) => (
            <li key={t.id} className="py-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{t.name}</span>
              <button
                type="button"
                onClick={() => deleteTag(t.id)}
                className="text-xs text-red-500 hover:underline"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Attribute definitions */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">カスタム属性定義</h2>
        <form onSubmit={createDef} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">code（英小文字と _）</label>
            <input
              value={defCode}
              onChange={(e) => setDefCode(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">ラベル</label>
            <input
              value={defLabel}
              onChange={(e) => setDefLabel(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">型</label>
            <select
              value={defType}
              onChange={(e) => setDefType(e.target.value as typeof defType)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            >
              <option value="text">text</option>
              <option value="number">number</option>
              <option value="select">select</option>
            </select>
          </div>
          {defType === 'select' && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">選択肢（1 行に 1 つ）</label>
              <textarea
                value={defOptions}
                onChange={(e) => setDefOptions(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={defBusy}
              className="px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg"
            >
              属性を追加
            </button>
          </div>
        </form>
        <ul className="divide-y divide-gray-100">
          {defs.map((d) => (
            <li key={d.id} className="py-2 flex items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{d.label}</span>{' '}
                <code className="text-xs text-gray-400">{d.code}</code>{' '}
                <span className="text-xs text-gray-400">({d.value_type})</span>
              </span>
              <button type="button" onClick={() => deleteDef(d.id)} className="text-xs text-red-500">
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Segments */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-2">セグメント作成</h2>
        <p className="text-xs text-gray-500 mb-4">
          条件をフォームで指定してセグメントを作成します。プレビュー人数は一覧から確認できます。
        </p>
        <form onSubmit={createSegment} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">名前</label>
            <input
              value={segName}
              onChange={(e) => setSegName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">友だち状態</label>
            <select
              value={followStatus}
              onChange={(e) => setFollowStatus(e.target.value as 'followed_only' | 'all')}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            >
              <option value="followed_only">フォロー中のみ</option>
              <option value="all">すべて</option>
            </select>
          </div>
          <TagPicker
            label="次のタグのいずれか（OR）"
            allTags={sortedTags}
            selected={tagAny}
            onToggle={(id) => setTagAny((s) => toggleInSet(s, id))}
          />
          <TagPicker
            label="次のタグをすべて含む（AND）"
            allTags={sortedTags}
            selected={tagAll}
            onToggle={(id) => setTagAll((s) => toggleInSet(s, id))}
          />
          <TagPicker
            label="次のタグを含まない（NOT）"
            allTags={sortedTags}
            selected={tagNone}
            onToggle={(id) => setTagNone((s) => toggleInSet(s, id))}
          />

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-700">属性フィルタ</span>
              <button
                type="button"
                className="text-xs text-green-600"
                onClick={() => {
                  if (!defs.length) return
                  setAttrRows((r) => [...r, { definition_id: defs[0]!.id, op: 'eq', value: '' }])
                }}
              >
                + 行を追加
              </button>
            </div>
            {attrRows.map((row, i) => (
              <div key={i} className="flex flex-wrap gap-2 mb-2 items-center">
                <select
                  value={row.definition_id}
                  onChange={(e) => {
                    const v = e.target.value
                    setAttrRows((rows) =>
                      rows.map((x, j) => (j === i ? { ...x, definition_id: v } : x)),
                    )
                  }}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white"
                >
                  {defs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <select
                  value={row.op}
                  onChange={(e) => {
                    const v = e.target.value
                    setAttrRows((rows) => rows.map((x, j) => (j === i ? { ...x, op: v } : x)))
                  }}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white"
                >
                  <option value="eq">=</option>
                  <option value="neq">≠</option>
                  <option value="contains">含む</option>
                  <option value="gt">&gt;</option>
                  <option value="gte">≥</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">≤</option>
                </select>
                <input
                  value={row.value}
                  onChange={(e) => {
                    const v = e.target.value
                    setAttrRows((rows) => rows.map((x, j) => (j === i ? { ...x, value: v } : x)))
                  }}
                  className="flex-1 min-w-[120px] text-sm border border-gray-200 rounded-lg px-2 py-1"
                  placeholder="値"
                />
                <button
                  type="button"
                  className="text-xs text-gray-400"
                  onClick={() => setAttrRows((rows) => rows.filter((_, j) => j !== i))}
                >
                  削除
                </button>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={segBusy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            {segBusy ? '作成中...' : 'セグメントを作成'}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-4">セグメント一覧とプレビュー</h2>
        {segments.length === 0 ? (
          <p className="text-sm text-gray-400">セグメントがありません</p>
        ) : (
          <ul className="space-y-3">
            {segments.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2"
              >
                <span className="text-sm font-medium">{s.name}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-green-600 font-medium"
                    onClick={() => setPreviewSegId(previewSegId === s.id ? null : s.id)}
                  >
                    {previewSegId === s.id ? 'プレビューを閉じる' : 'プレビュー人数'}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-500"
                    onClick={async () => {
                      if (!confirm('削除しますか？')) return
                      await fetch(`/api/services/${serviceId}/line-messaging/segments/${s.id}`, {
                        method: 'DELETE',
                      })
                      mutSeg()
                    }}
                  >
                    削除
                  </button>
                </div>
                {previewSegId === s.id && (
                  <div className="w-full mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2">
                    {previewResp?.success ? (
                      <>
                        <p>
                          一致人数:{' '}
                          <strong className="text-lg text-green-800">
                            {(previewResp.data as { count: number }).count}
                          </strong>
                        </p>
                        <p className="text-gray-400 mt-1 font-mono truncate">
                          サンプル:{' '}
                          {(previewResp.data as { sample_line_user_ids: string[] }).sample_line_user_ids.join(
                            ', ',
                          )}
                        </p>
                      </>
                    ) : (
                      <p>読み込み中またはエラー</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function TagPicker({
  label,
  allTags,
  selected,
  onToggle,
}: {
  label: string
  allTags: Tag[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-700 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {allTags.map((t) => (
          <label
            key={t.id}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs cursor-pointer ${
              selected.has(t.id) ? 'border-green-500 bg-green-50' : 'border-gray-200'
            }`}
          >
            <input type="checkbox" checked={selected.has(t.id)} onChange={() => onToggle(t.id)} />
            {t.name}
          </label>
        ))}
      </div>
      {allTags.length === 0 && <p className="text-xs text-gray-400">タグを先に作成してください</p>}
    </div>
  )
}
