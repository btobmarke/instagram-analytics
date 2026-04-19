'use client'

import { use, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { LineMaBreadcrumb, LineMaNav } from '../line-ma-nav'

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
  /** 現在ページのカーソル（先頭ページは null） */
  const [cursor, setCursor] = useState<string | null>(null)
  /** 「戻る」用に積む直前ページのカーソル */
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([])

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
    q.set('limit', '50')
    if (cursor) q.set('cursor', cursor)
    return `/api/services/${serviceId}/line-messaging/contacts?${q}`
  }, [serviceId, tagFilter, cursor])

  const { data: listResp, isLoading } = useSWR(
    service?.service_type === 'line' ? listUrl : null,
    fetcher,
  )

  const rows: ContactRow[] = listResp?.data ?? []
  const nextCursor: string | null = listResp?.next_cursor ?? null

  const resetFilter = () => {
    setCursor(null)
    setCursorStack([])
  }

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

      <LineMaNav projectId={projectId} serviceId={serviceId} />

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
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">コンタクトがありません</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">表示名</th>
                <th className="px-4 py-3 font-medium">LINE userId</th>
                <th className="px-4 py-3 font-medium">友だち</th>
                <th className="px-4 py-3 font-medium">最終接触</th>
                <th className="px-4 py-3 font-medium w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.display_name ?? '—'}</td>
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
        <div className="px-4 py-3 bg-gray-50 flex items-center justify-between gap-2">
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
      </div>
    </div>
  )
}
