'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

export default function LineMaBroadcastJobPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string; jobId: string }>
}) {
  const { projectId, serviceId, jobId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const detailUrl = `/api/services/${serviceId}/line-messaging/broadcast-jobs/${jobId}`
  const { data: detailResp, mutate } = useSWR(
    service?.service_type === 'line' ? detailUrl : null,
    fetcher,
  )

  const job = detailResp?.data?.job
  const counts = detailResp?.data?.recipient_counts
  const recipients = detailResp?.data?.recipients ?? []

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const cancel = async () => {
    if (!confirm('このジョブをキャンセルしますか？')) return
    setBusy(true)
    setMsg(null)
    const res = await fetch(`${detailUrl}/cancel`, { method: 'POST' })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) {
      setMsg(json.error ?? 'キャンセルに失敗しました')
      return
    }
    setMsg('キャンセルしました')
    mutate()
  }

  const retryFailed = async () => {
    if (!confirm('失敗した受信者を再試行用に pending に戻しますか？')) return
    setBusy(true)
    setMsg(null)
    const res = await fetch(`${detailUrl}/retry-failed`, { method: 'POST' })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) {
      setMsg(json.error ?? '再試行の準備に失敗しました')
      return
    }
    setMsg('失敗分を pending に戻しました')
    mutate()
  }

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  if (detailResp && detailResp.error === 'not_found') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-gray-600">ジョブが見つかりません。</p>
        <Link href={`/projects/${projectId}/services/${serviceId}/line-ma/broadcast`} className="text-green-600 text-sm mt-2 inline-block">
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
        extra="配信ジョブ詳細"
      />
      <div className="mb-4">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/line-ma/broadcast`}
          className="text-xs text-green-600 hover:underline"
        >
          ← 一覧
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          📣
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">配信ジョブ</h1>
          <p className="text-sm text-gray-400 font-mono">{jobId}</p>
        </div>
      </div>

      {!job ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {msg && <p className="text-sm text-gray-700 mb-4 bg-green-50 border border-green-100 rounded px-3 py-2">{msg}</p>}

          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-gray-400">名前</dt>
                <dd className="font-medium">{job.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">ステータス</dt>
                <dd className="font-medium">{job.status}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">対象</dt>
                <dd>{job.recipient_source}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">予約</dt>
                <dd>{job.scheduled_at ? new Date(job.scheduled_at).toLocaleString('ja-JP') : '即時'}</dd>
              </div>
            </dl>
            {job.last_error && (
              <p className="text-sm text-red-600 mt-4">エラー: {job.last_error}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-6">
              <button
                type="button"
                disabled={busy || job.status === 'cancelled' || job.status === 'completed'}
                onClick={cancel}
                className="px-4 py-2 text-sm border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-50 disabled:opacity-40"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={retryFailed}
                className="px-4 py-2 text-sm border border-green-300 text-green-800 rounded-lg hover:bg-green-50 disabled:opacity-40"
              >
                失敗分を再試行
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <h2 className="font-bold text-gray-900 mb-4">受信者集計</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-gray-400">pending</p>
                <p className="text-2xl font-bold text-gray-800">{counts?.pending ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">sent</p>
                <p className="text-2xl font-bold text-green-700">{counts?.sent ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">failed</p>
                <p className="text-2xl font-bold text-red-600">{counts?.failed ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">受信者（先頭）</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-2">line_user_id</th>
                    <th className="py-2 pr-2">status</th>
                    <th className="py-2">error</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r: { line_user_id: string; status: string; error_message: string | null }) => (
                    <tr key={r.line_user_id} className="border-b border-gray-50">
                      <td className="py-1.5 pr-2 font-mono truncate max-w-[200px]">{r.line_user_id}</td>
                      <td className="py-1.5 pr-2">{r.status}</td>
                      <td className="py-1.5 text-red-600 truncate max-w-xs">{r.error_message ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
