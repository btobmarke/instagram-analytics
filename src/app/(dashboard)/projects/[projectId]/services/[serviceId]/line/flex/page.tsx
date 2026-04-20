'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'


const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

const FLEX_STUB = `{
  "type": "bubble",
  "body": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      { "type": "text", "text": "Hello Flex", "weight": "bold", "size": "md" }
    ]
  }
}`

export default function LineMaFlexListPage({
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

  const { data: listResp, mutate } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/flex-templates` : null,
    fetcher,
  )
  const rows: { id: string; name: string; template_kind: string; updated_at: string }[] = listResp?.data ?? []

  const [name, setName] = useState('')
  const [kind, setKind] = useState<'flex' | 'carousel'>('flex')
  const [jsonText, setJsonText] = useState(FLEX_STUB)
  const [busy, setBusy] = useState(false)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    let template_json: Record<string, unknown>
    try {
      template_json = JSON.parse(jsonText) as Record<string, unknown>
    } catch {
      alert('JSON が不正です')
      return
    }
    setBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/flex-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        template_kind: kind,
        template_json,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '作成に失敗しました')
      return
    }
    setName('')
    mutate()
  }

  const deleteTpl = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/flex-templates/${id}`, { method: 'DELETE' })
    mutate()
  }

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  return (
    <div className="w-full max-w-none min-w-0">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          🎴
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Flex / Carousel（UI-8）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <p className="text-xs text-gray-600 bg-gray-50 border rounded-lg px-3 py-2 mb-6">
        carousel の場合は、バブル配列、または <code className="font-mono">{'{'} "contents": [...] {'}'}</code>{' '}
        形式で保存してください（プレビュー API と同じ解釈です）。
      </p>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">新規テンプレート</h2>
        <form onSubmit={create} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="名前"
              className="flex-1 min-w-[200px] px-3 py-2 text-sm border rounded-lg"
              required
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'flex' | 'carousel')}
              className="px-3 py-2 text-sm border rounded-lg bg-white"
            >
              <option value="flex">flex</option>
              <option value="carousel">carousel</option>
            </select>
          </div>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={14}
            className="w-full px-3 py-2 text-xs font-mono border rounded-lg"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            {busy ? '作成中...' : '作成'}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-4">一覧</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">テンプレートがありません</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((t) => (
              <li key={t.id} className="py-3 flex justify-between gap-2 items-center">
                <div>
                  <Link
                    href={`/projects/${projectId}/services/${serviceId}/line/flex/${t.id}`}
                    className="text-sm font-medium text-green-700 hover:underline"
                  >
                    {t.name}
                  </Link>
                  <p className="text-xs text-gray-400">
                    {t.template_kind} · {new Date(t.updated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <button type="button" className="text-xs text-red-500" onClick={() => deleteTpl(t.id)}>
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
