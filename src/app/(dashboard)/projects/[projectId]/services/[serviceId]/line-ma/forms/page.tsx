'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

interface FormRow {
  id: string
  title: string
  slug: string
  enabled: boolean
}

export default function LineMaFormsListPage({
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

  const { data: formsResp, mutate } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/forms` : null,
    fetcher,
  )
  const forms: FormRow[] = formsResp?.data ?? []

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const createForm = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        enabled: true,
        post_submit_actions: [],
      }),
    })
    setBusy(false)
    if (res.ok) {
      setTitle('')
      setSlug('')
      setDescription('')
      mutate()
    } else {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '作成に失敗しました')
    }
  }

  const deleteForm = async (id: string) => {
    if (!confirm('フォームを削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/forms/${id}`, { method: 'DELETE' })
    mutate()
  }

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
        extra="フォーム"
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          📋
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">フォーム（UI-6）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">フォームを作成</h2>
        <form onSubmit={createForm} className="space-y-3 max-w-xl">
          <div>
            <label className="text-xs text-gray-500">タイトル</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">スラッグ（小文字英数とハイフン）</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="contact-form"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">説明（任意）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            作成
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-4">一覧</h2>
        {forms.length === 0 ? (
          <p className="text-sm text-gray-400">フォームがありません</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {forms.map((f) => (
              <li key={f.id} className="py-3 flex items-center justify-between gap-2">
                <div>
                  <Link
                    href={`/projects/${projectId}/services/${serviceId}/line-ma/forms/${f.id}`}
                    className="text-sm font-medium text-green-700 hover:underline"
                  >
                    {f.title}
                  </Link>
                  <p className="text-xs text-gray-400 font-mono">{f.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      f.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {f.enabled ? '有効' : '無効'}
                  </span>
                  <button type="button" onClick={() => deleteForm(f.id)} className="text-xs text-red-500">
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
