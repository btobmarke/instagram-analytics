'use client'

import { use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { InstagramServiceSubnav } from '@/components/instagram/InstagramServiceSubnav'
import { InstagramLikeUsersAnalysis } from '@/components/instagram/InstagramLikeUsersAnalysis'
import { InstagramFollowerImportButtonModal } from '@/components/instagram/InstagramFollowerImportButtonModal'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
  type_config: { ig_account_ref_id?: string; username?: string } | null
}

export default function InstagramServiceLikeUsersPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: serviceData, mutate: mutateService } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = serviceData?.data
  const accountId = service?.type_config?.ig_account_ref_id
  const accountCaption = service?.type_config?.username ? `@${service.type_config.username}` : null

  const postsHref = `/projects/${projectId}/services/${serviceId}/instagram/posts`

  return (
    <div className="p-6 w-full max-w-none min-w-0 space-y-6 pb-16">
      <nav className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
        <Link href="/clients" className="hover:text-purple-600">
          クライアント一覧
        </Link>
        <span>›</span>
        <Link href={`/clients/${service?.client.id}`} className="hover:text-purple-600">
          {service?.client.client_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">
          {service?.project.project_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/instagram`} className="hover:text-pink-600">
          {service?.service_name ?? 'Instagram'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">いいねユーザー</span>
      </nav>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-xl flex-shrink-0">
            📸
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Instagram</h1>
            <p className="text-sm text-gray-400">{service?.service_name}</p>
          </div>
        </div>
        <InstagramFollowerImportButtonModal accountId={accountId} onImported={() => { void mutateService() }} />
      </div>

      <InstagramServiceSubnav projectId={projectId} serviceId={serviceId} active="like-users" />

      {!accountId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center text-amber-800">
          <p className="font-semibold mb-1">Instagram アカウントが未連携です</p>
          <Link
            href={`/projects/${projectId}/services/${serviceId}/instagram`}
            className="text-sm text-amber-700 font-medium hover:underline"
          >
            ← サービスページでアカウントを連携する
          </Link>
        </div>
      ) : (
        <InstagramLikeUsersAnalysis
          accountId={accountId}
          postsListHref={postsHref}
          accountCaption={accountCaption}
          hideFollowerImport
        />
      )}
    </div>
  )
}
