'use client'

import { use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../line-ma-nav'
import { MessagingApiSetup } from '../_components/messaging-api-setup'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  service_type: string
  project: { id: string; project_name: string }
}

export default function LineMaConnectionPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const base = `/projects/${projectId}/services/${serviceId}`

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  if (service && service.service_type !== 'line') {
    return (
      <div className="p-6 w-full max-w-none">
        <p className="text-sm text-gray-600">
          このサービスは LINE タイプではありません。プロジェクトの LINE サービスから開いてください。
        </p>
        <Link href={`/projects/${projectId}`} className="text-sm text-purple-600 mt-4 inline-block">
          プロジェクトに戻る
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 w-full max-w-none">
      <LineMaBreadcrumb
        projectId={projectId}
        serviceId={serviceId}
        projectName={service?.project.project_name ?? ''}
        serviceName={service?.service_name ?? ''}
        extra="接続（認証）"
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          🔐
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Messaging API 接続</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-6">
        OAM 用の <strong>bot_id</strong> や <strong>リワードカード</strong> は{' '}
        <Link href={`${base}/line`} className="text-green-600 font-medium hover:underline">
          LINE 設定（統合）
        </Link>
        にまとめています。
      </p>

      <MessagingApiSetup serviceId={serviceId} />
    </div>
  )
}
