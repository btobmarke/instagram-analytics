'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'

import { LineBreadcrumb, LineNav } from './line-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

type TopTab = 'dashboard' | 'functions' | 'settings'

function topTabFromPathname(pathname: string): TopTab {
  const i = pathname.indexOf('/line')
  if (i < 0) return 'functions'
  const suffix = pathname.slice(i + '/line'.length) || '/'
  if (suffix === '/' || suffix === '') return 'settings'
  if (suffix.startsWith('/dashboard')) return 'dashboard'
  return 'functions'
}

export function LineAppShell({
  projectId,
  serviceId,
  children,
}: {
  projectId: string
  serviceId: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const base = `/projects/${projectId}/services/${serviceId}`
  const top = topTabFromPathname(pathname)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const tabInactive =
    'px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px'
  const tabActive = 'px-4 py-2.5 text-sm font-medium text-green-600 border-b-2 border-green-600 -mb-px'

  return (
    <div className="line-app-layout w-full max-w-none min-w-0">
      <div className="p-6 w-full max-w-none min-w-0">
        <LineBreadcrumb
          projectId={projectId}
          serviceId={serviceId}
          projectName={service?.project.project_name ?? ''}
          serviceName={service?.service_name ?? ''}
        />

        <div className="flex items-center gap-1 mb-4 border-b border-gray-200 flex-wrap">
          <Link href={`${base}/line/dashboard`} className={top === 'dashboard' ? tabActive : tabInactive}>
            ダッシュボード
          </Link>
          <Link href={`${base}/line/contacts`} className={top === 'functions' ? tabActive : tabInactive}>
            機能（MA）
          </Link>
          <Link href={`${base}/line`} className={top === 'settings' ? tabActive : tabInactive}>
            設定
          </Link>
          <Link href={`${base}/summary`} className={tabInactive}>
            サマリー
          </Link>
        </div>

        {top === 'functions' && <LineNav projectId={projectId} serviceId={serviceId} />}

        <div className="w-full max-w-none min-w-0">{children}</div>
      </div>
    </div>
  )
}
