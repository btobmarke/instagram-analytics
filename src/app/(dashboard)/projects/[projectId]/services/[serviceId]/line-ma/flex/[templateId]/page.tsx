'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

export default function LineMaFlexDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string; templateId: string }>
}) {
  const { projectId, serviceId, templateId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const url = `/api/services/${serviceId}/line-messaging/flex-templates/${templateId}`
  const { data: tplResp, mutate, isLoading } = useSWR(
    service?.service_type === 'line' ? url : null,
    fetcher,
  )

  const tpl = tplResp?.data as
    | {
        name: string
        template_kind: 'flex' | 'carousel'
        template_json: Record<string, unknown>
      }
    | undefined

  const [name, setName] = useState('')
  const [kind, setKind] = useState<'flex' | 'carousel'>('flex')
  const [jsonText, setJsonText] = useState('{}')
  const [saving, setSaving] = useState(false)
  const [previewTo, setPreviewTo] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)

  useEffect(() => {
    if (!tpl) return
    setName(tpl.name)
    setKind(tpl.template_kind)
    setJsonText(JSON.stringify(tpl.template_json, null, 2))
  }, [templateId, tpl])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    let template_json: Record<string, unknown>
    try {
      template_json = JSON.parse(jsonText) as Record<string, unknown>
    } catch {
      alert('JSON が不正です')
      return
    }
    setSaving(true)
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), template_kind: kind, template_json }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '保存に失敗しました')
      return
    }
    mutate()
    alert('保存しました')
  }

  const previewPush = async () => {
    if (!previewTo.trim()) {
      alert('line_user_id を入力してください')
      return
    }
    setPreviewBusy(true)
    const res = await fetch(
      `/api/services/${serviceId}/line-messaging/flex-templates/${templateId}/preview-push`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: previewTo.trim() }),
      },
    )
    const j = await res.json().catch(() => ({}))
    setPreviewBusy(false)
    if (!res.ok) alert(j.message ?? j.error ?? '送信に失敗しました')
    else alert('プレビューを送信しました')
  }

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  if (!isLoading && tplResp?.error === 'not_found') {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600">テンプレートが見つかりません。</p>
        <Link href={`/projects/${projectId}/services/${serviceId}/line-ma/flex`} className="text-green-600 text-sm mt-2 inline-block">
          一覧へ
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
        extra="Flex 編集"
      />
      <div className="mb-4">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/line-ma/flex`}
          className="text-xs text-green-600 hover:underline"
        >
          ← 一覧
        </Link>
      </div>

      {isLoading || !tpl ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <form onSubmit={save} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 mb-6">
            <h1 className="text-xl font-bold text-gray-900">{name}</h1>
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 min-w-[200px] px-3 py-2 text-sm border rounded-lg"
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
              rows={20}
              className="w-full px-3 py-2 text-xs font-mono border rounded-lg"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </form>

          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-3">プレビュー送信</h2>
            <p className="text-xs text-gray-500 mb-3">保存済みトークンで指定ユーザーに 1 通プッシュします。</p>
            <div className="flex flex-wrap gap-2 max-w-xl">
              <input
                value={previewTo}
                onChange={(e) => setPreviewTo(e.target.value)}
                placeholder="line_user_id（U...）"
                className="flex-1 px-3 py-2 text-sm border rounded-lg font-mono"
              />
              <button
                type="button"
                disabled={previewBusy}
                onClick={previewPush}
                className="px-4 py-2 text-sm font-medium text-green-800 border border-green-300 rounded-lg disabled:opacity-60"
              >
                {previewBusy ? '送信中...' : 'プレビュー送信'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
