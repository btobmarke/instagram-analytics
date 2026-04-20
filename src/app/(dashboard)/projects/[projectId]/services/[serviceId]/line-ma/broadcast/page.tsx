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

interface Template {
  id: string
  name: string
  body_text: string
}

interface Job {
  id: string
  name: string | null
  template_id: string
  recipient_source: string
  segment_id: string | null
  scheduled_at: string | null
  status: string
  last_error: string | null
  created_at: string
}

interface Segment {
  id: string
  name: string
}

export default function LineMaBroadcastPage({
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

  const { data: tplResp, mutate: mutTpl } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/templates` : null,
    fetcher,
  )
  const templates: Template[] = tplResp?.data ?? []

  const { data: jobResp, mutate: mutJob } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/broadcast-jobs` : null,
    fetcher,
  )
  const jobs: Job[] = jobResp?.data ?? []

  const { data: segResp } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/segments` : null,
    fetcher,
  )
  const segments: Segment[] = segResp?.data ?? []

  const [tplName, setTplName] = useState('')
  const [tplBody, setTplBody] = useState('')
  const [tplBusy, setTplBusy] = useState(false)

  const [jobName, setJobName] = useState('')
  const [jobTemplateId, setJobTemplateId] = useState('')
  const [recipientSource, setRecipientSource] = useState<'all_followed' | 'explicit' | 'segment'>(
    'all_followed',
  )
  const [explicitIds, setExplicitIds] = useState('')
  const [segmentId, setSegmentId] = useState('')
  const [scheduledLocal, setScheduledLocal] = useState('')
  const [jobBusy, setJobBusy] = useState(false)
  const [jobMsg, setJobMsg] = useState<string | null>(null)

  const createTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    setTplBusy(true)
    await fetch(`/api/services/${serviceId}/line-messaging/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tplName.trim(), body_text: tplBody }),
    })
    setTplBusy(false)
    setTplName('')
    setTplBody('')
    mutTpl()
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('このテンプレートを削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/templates/${id}`, { method: 'DELETE' })
    mutTpl()
  }

  const createJob = async (e: React.FormEvent) => {
    e.preventDefault()
    setJobMsg(null)
    if (!jobTemplateId) {
      setJobMsg('テンプレートを選択してください')
      return
    }
    let scheduled_at: string | undefined
    if (scheduledLocal.trim()) {
      const d = new Date(scheduledLocal)
      if (Number.isNaN(d.getTime())) {
        setJobMsg('予約日時が不正です')
        return
      }
      scheduled_at = d.toISOString()
    }
    const body: Record<string, unknown> = {
      template_id: jobTemplateId,
      name: jobName.trim() || undefined,
      recipient_source: recipientSource,
      scheduled_at,
    }
    if (recipientSource === 'explicit') {
      const ids = explicitIds
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      body.explicit_line_user_ids = ids
    }
    if (recipientSource === 'segment') {
      body.segment_id = segmentId
    }

    setJobBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/broadcast-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setJobBusy(false)
    if (!res.ok) {
      setJobMsg(json.error ?? 'ジョブ作成に失敗しました')
      return
    }
    setJobMsg('配信ジョブを作成しました（バッチ処理で送信されます）')
    setJobName('')
    mutJob()
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
        extra="テンプレ・配信"
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          📣
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">テンプレート・一斉配信（UI-4）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">メッセージテンプレート</h2>
        <form onSubmit={createTemplate} className="space-y-3 mb-6">
          <input
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            placeholder="テンプレート名"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            required
          />
          <textarea
            value={tplBody}
            onChange={(e) => setTplBody(e.target.value)}
            placeholder="本文（テキスト）"
            rows={4}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            required
          />
          <button
            type="submit"
            disabled={tplBusy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            追加
          </button>
        </form>
        <ul className="divide-y divide-gray-100">
          {templates.map((t) => (
            <li key={t.id} className="py-3 flex justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-gray-500 line-clamp-2">{t.body_text}</p>
              </div>
              <button
                type="button"
                onClick={() => deleteTemplate(t.id)}
                className="text-xs text-red-500 flex-shrink-0"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-2">一斉配信ジョブを作成</h2>
        <p className="text-xs text-gray-500 mb-4">
          予約日時を空にすると即時送信対象になります（バッチの実行タイミングに依存）。セグメントは CRM で作成してください。
        </p>
        {jobMsg && <p className="text-sm text-green-800 bg-green-50 border border-green-100 rounded px-3 py-2 mb-4">{jobMsg}</p>}
        <form onSubmit={createJob} className="space-y-4 max-w-xl">
          <div>
            <label className="block text-xs text-gray-500 mb-1">ジョブ名（任意）</label>
            <input
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">テンプレート</label>
            <select
              value={jobTemplateId}
              onChange={(e) => setJobTemplateId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
              required
            >
              <option value="">選択...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">配信対象</label>
            <select
              value={recipientSource}
              onChange={(e) =>
                setRecipientSource(e.target.value as 'all_followed' | 'explicit' | 'segment')
              }
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            >
              <option value="all_followed">友だち（フォロー中）全員</option>
              <option value="explicit">LINE userId を明示</option>
              <option value="segment">セグメント</option>
            </select>
          </div>
          {recipientSource === 'explicit' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">LINE userId（カンマまたは改行区切り）</label>
              <textarea
                value={explicitIds}
                onChange={(e) => setExplicitIds(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              />
            </div>
          )}
          {recipientSource === 'segment' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">セグメント</label>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                required
              >
                <option value="">選択...</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">予約日時（ローカル・空なら即時扱い）</label>
            <input
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={jobBusy}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
          >
            {jobBusy ? '作成中...' : 'ジョブを作成'}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-4">ジョブ一覧</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-400">ジョブがありません</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {jobs.map((j) => (
              <li key={j.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{j.name ?? '（無題）'}</p>
                  <p className="text-xs text-gray-400">
                    {j.status} · {j.recipient_source} ·{' '}
                    {j.scheduled_at ? new Date(j.scheduled_at).toLocaleString('ja-JP') : '即時'}
                  </p>
                  {j.last_error && (
                    <p className="text-xs text-red-600 mt-1 truncate max-w-md">{j.last_error}</p>
                  )}
                </div>
                <Link
                  href={`/projects/${projectId}/services/${serviceId}/line-ma/broadcast/${j.id}`}
                  className="text-sm text-green-600 font-medium"
                >
                  詳細
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
