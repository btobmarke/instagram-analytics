'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

interface ContactRow {
  id: string
  line_user_id: string
  display_name: string | null
  picture_url: string | null
  is_followed: boolean | null
  lead_status: string | null
  last_interaction_at: string | null
}

interface Tag {
  id: string
  name: string
  color: string | null
}

export default function LineMaContactsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [tagFilter, setTagFilter] = useState<string>('')
  const [searchInput, setSearchInput] = useState('')
  /** 一覧 API に渡す検索語（ボタン／Enter で確定） */
  const [searchQuery, setSearchQuery] = useState('')
  /** 現在ページのカーソル（先頭ページは null） */
  const [cursor, setCursor] = useState<string | null>(null)
  /** 「戻る」用に積む直前ページのカーソル */
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const [bulkAddTagIds, setBulkAddTagIds] = useState<string[]>([])
  const [bulkRemoveTagIds, setBulkRemoveTagIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)
  const pageSelectAllRef = useRef<HTMLInputElement>(null)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const { data: tagsData } = useSWR<{ success: boolean; data: Tag[] }>(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/tags` : null,
    fetcher,
  )
  const tags = tagsData?.data ?? []

  const listUrl = useMemo(() => {
    const q = new URLSearchParams()
    if (tagFilter) q.set('tag_id', tagFilter)
    if (searchQuery) q.set('search', searchQuery)
    q.set('limit', '50')
    if (cursor) q.set('cursor', cursor)
    return `/api/services/${serviceId}/line-messaging/contacts?${q}`
  }, [serviceId, tagFilter, searchQuery, cursor])

  const { data: listResp, isLoading, mutate: mutList } = useSWR(
    service?.service_type === 'line' ? listUrl : null,
    fetcher,
  )

  const rows: ContactRow[] = listResp?.data ?? []
  const nextCursor: string | null = listResp?.next_cursor ?? null

  const resetFilter = useCallback(() => {
    setCursor(null)
    setCursorStack([])
  }, [])

  const applySearch = useCallback(() => {
    setSearchQuery(searchInput.trim())
    resetFilter()
  }, [searchInput, resetFilter])

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows])
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const somePageSelected = pageIds.some((id) => selectedIds.has(id))

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const togglePageAll = () => {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (allPageSelected) {
        for (const id of pageIds) n.delete(id)
      } else {
        for (const id of pageIds) n.add(id)
      }
      return n
    })
  }

  const clearAllSelection = () => {
    setSelectedIds(new Set())
    setCopyMsg(null)
  }

  const selectedRows = useMemo(() => {
    const map = new Map(rows.map((r) => [r.id, r]))
    return [...selectedIds].map((id) => map.get(id)).filter(Boolean) as ContactRow[]
  }, [rows, selectedIds])

  const copyText = async (label: string, text: string) => {
    setCopyMsg(null)
    try {
      await navigator.clipboard.writeText(text)
      setCopyMsg(`${label}をコピーしました`)
    } catch {
      setCopyMsg('コピーに失敗しました（ブラウザの権限を確認してください）')
    }
  }

  const copySelectedContactIds = () => {
    const lines = [...selectedIds].sort()
    void copyText('選択したコンタクト ID', JSON.stringify(lines, null, 2))
  }

  const copySelectedLineUserIds = () => {
    const ids = selectedRows.map((r) => r.line_user_id).sort()
    void copyText('LINE userId（改行）', ids.join('\n'))
  }

  const BULK_MAX = 500

  const runBulkTags = async (mode: 'add' | 'remove') => {
    const contact_ids = [...selectedIds]
    if (contact_ids.length === 0) return
    if (contact_ids.length > BULK_MAX) {
      setBulkMsg(`選択は最大 ${BULK_MAX} 件までです`)
      return
    }
    const tag_ids_to_add = mode === 'add' ? bulkAddTagIds : []
    const tag_ids_to_remove = mode === 'remove' ? bulkRemoveTagIds : []
    if (mode === 'add' && tag_ids_to_add.length === 0) {
      setBulkMsg('付与するタグを 1 つ以上選んでください（Ctrl で複数）')
      return
    }
    if (mode === 'remove' && tag_ids_to_remove.length === 0) {
      setBulkMsg('解除するタグを 1 つ以上選んでください（Ctrl で複数）')
      return
    }
    const label =
      mode === 'add'
        ? `選択中 ${contact_ids.length} 件にタグを付与します（既に付いている組み合わせはスキップ）`
        : `選択中 ${contact_ids.length} 件からタグを外します`
    if (!window.confirm(`${label}。よろしいですか？`)) return

    setBulkBusy(true)
    setBulkMsg(null)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/contacts/bulk-tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_ids,
        tag_ids_to_add,
        tag_ids_to_remove,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setBulkBusy(false)
    if (!res.ok) {
      setBulkMsg(
        typeof json.message === 'string'
          ? json.message
          : json.error === 'validation_error'
            ? '入力内容を確認してください'
            : json.error ?? '一括タグの更新に失敗しました',
      )
      return
    }
    const d = json.data as { links_inserted?: number; rows_deleted?: number } | undefined
    if (mode === 'add') {
      setBulkMsg(`付与しました（新規リンク ${d?.links_inserted ?? 0} 件）`)
      setBulkAddTagIds([])
    } else {
      setBulkMsg(`解除しました（削除 ${d?.rows_deleted ?? 0} 行）`)
      setBulkRemoveTagIds([])
    }
    void mutList()
  }

  const copySelectedDetailLinks = () => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : ''
    const lines = selectedRows.map(
      (r) =>
        `${origin}/projects/${projectId}/services/${serviceId}/line-ma/contacts/${r.id}`,
    )
    void copyText('詳細URL（改行）', lines.join('\n'))
  }

  useEffect(() => {
    setCopyMsg(null)
  }, [selectedIds])

  useEffect(() => {
    const el = pageSelectAllRef.current
    if (el) el.indeterminate = !allPageSelected && somePageSelected
  }, [allPageSelected, somePageSelected])

  if (service && service.service_type !== 'line') {
    return (
      <div className="p-6 max-w-4xl mx-auto text-sm text-gray-600">
        LINE サービスではありません。
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <LineMaBreadcrumb
        projectId={projectId}
        serviceId={serviceId}
        projectName={service?.project.project_name ?? ''}
        serviceName={service?.service_name ?? ''}
        extra="コンタクト"
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          👤
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">コンタクト（UI-2）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-xs text-gray-600">
          タグで絞り込み
          <select
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value)
              resetFilter()
            }}
            className="block mt-1 min-w-[200px] px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
          >
            <option value="">（すべて）</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600 block">
            名前・LINE userId で検索
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applySearch()
                }
              }}
              placeholder="表示名または userId の一部"
              className="block mt-1 min-w-[220px] px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </label>
          <button
            type="button"
            onClick={applySearch}
            className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700"
          >
            検索
          </button>
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                setSearchQuery('')
                resetFilter()
              }}
              className="px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              検索をクリア
            </button>
          ) : null}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50/80 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="font-medium text-green-900">
              {selectedIds.size} 件を選択中（ページをまたいで保持されます）
            </span>
            <button
              type="button"
              onClick={clearAllSelection}
              className="text-xs text-red-600 hover:underline"
            >
              すべての選択を解除
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copySelectedContactIds}
              className="px-2 py-1 text-xs font-medium bg-white border border-green-300 rounded-lg hover:bg-green-50"
            >
              コンタクト ID（JSON）をコピー
            </button>
            <button
              type="button"
              onClick={copySelectedLineUserIds}
              className="px-2 py-1 text-xs font-medium bg-white border border-green-300 rounded-lg hover:bg-green-50"
            >
              LINE userId（改行）をコピー
            </button>
            <button
              type="button"
              onClick={copySelectedDetailLinks}
              className="px-2 py-1 text-xs font-medium bg-white border border-green-300 rounded-lg hover:bg-green-50"
            >
              詳細URL（改行）をコピー
            </button>
          </div>
          {copyMsg && <p className="text-xs text-gray-600 mt-2">{copyMsg}</p>}

          <div className="mt-4 pt-4 border-t border-green-200/80">
            <p className="text-xs text-green-900 font-medium mb-2">一括タグ（最大 {BULK_MAX} 件まで）</p>
            <p className="text-[11px] text-gray-600 mb-3">
              付与は既存タグに<strong>追加</strong>します（コンタクト詳細の「全置換」とは異なります）。その後、CRM
              で「このタグを含む」セグメントを作れば一斉配信・リッチメニューに使えます。
            </p>
            {selectedIds.size > BULK_MAX && (
              <p className="text-xs text-amber-700 mb-2">選択が {BULK_MAX} 件を超えています。一括タグは先に選択を減らしてください。</p>
            )}
            {tags.length === 0 ? (
              <p className="text-xs text-gray-500">タグがありません。先に CRM でタグを作成してください。</p>
            ) : (
              <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs text-gray-600 mb-1">付与（Ctrl / ⌘ で複数）</label>
                  <select
                    multiple
                    size={Math.min(8, tags.length)}
                    value={bulkAddTagIds}
                    onChange={(e) =>
                      setBulkAddTagIds(Array.from(e.target.selectedOptions, (o) => o.value))
                    }
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white"
                  >
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={bulkBusy || selectedIds.size === 0 || selectedIds.size > BULK_MAX}
                    onClick={() => void runBulkTags('add')}
                    className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-green-700 rounded-lg hover:bg-green-800 disabled:opacity-50"
                  >
                    {bulkBusy ? '処理中...' : '付与を実行'}
                  </button>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs text-gray-600 mb-1">解除（Ctrl / ⌘ で複数）</label>
                  <select
                    multiple
                    size={Math.min(8, tags.length)}
                    value={bulkRemoveTagIds}
                    onChange={(e) =>
                      setBulkRemoveTagIds(Array.from(e.target.selectedOptions, (o) => o.value))
                    }
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white"
                  >
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={bulkBusy || selectedIds.size === 0 || selectedIds.size > BULK_MAX}
                    onClick={() => void runBulkTags('remove')}
                    className="mt-2 px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-50 disabled:opacity-50"
                  >
                    {bulkBusy ? '処理中...' : '解除を実行'}
                  </button>
                </div>
              </div>
            )}
            {bulkMsg && <p className="text-xs text-gray-700 mt-2">{bulkMsg}</p>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">該当するコンタクトがありません</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-2 py-3 w-10">
                  <input
                    ref={pageSelectAllRef}
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePageAll}
                    aria-label="このページをすべて選択"
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-2 py-3 font-medium">表示名</th>
                <th className="px-4 py-3 font-medium">LINE userId</th>
                <th className="px-4 py-3 font-medium">友だち</th>
                <th className="px-4 py-3 font-medium">最終接触</th>
                <th className="px-4 py-3 font-medium w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-2 py-3 align-middle">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleRow(c.id)}
                      aria-label={`選択: ${c.display_name ?? c.line_user_id}`}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-2 py-3 font-medium text-gray-900">{c.display_name ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 truncate max-w-[200px]">
                    {c.line_user_id}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        c.is_followed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {c.is_followed ? 'フォロー中' : '未フォロー'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {c.last_interaction_at
                      ? new Date(c.last_interaction_at).toLocaleString('ja-JP')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${projectId}/services/${serviceId}/line-ma/contacts/${c.id}`}
                      className="text-green-600 text-xs font-medium hover:underline"
                    >
                      詳細
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 py-3 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={cursorStack.length === 0}
              onClick={() => {
                if (cursorStack.length === 0) return
                const popped = cursorStack[cursorStack.length - 1]
                setCursorStack((s) => s.slice(0, -1))
                setCursor(popped)
              }}
              className="text-xs text-gray-600 disabled:opacity-40 hover:underline"
            >
              前のページ
            </button>
            <button
              type="button"
              disabled={!nextCursor}
              onClick={() => {
                if (!nextCursor) return
                setCursorStack((s) => [...s, cursor])
                setCursor(nextCursor)
              }}
              className="text-xs text-green-700 font-medium disabled:opacity-40 hover:underline"
            >
              次のページ
            </button>
          </div>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={togglePageAll}
              className="text-xs text-gray-600 hover:underline"
            >
              {allPageSelected ? 'このページの選択を解除' : 'このページをすべて選択'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
