'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '', label: '接続' },
  { href: '/contacts', label: 'コンタクト' },
  { href: '/crm', label: 'タグ・属性・セグメント' },
  { href: '/broadcast', label: 'テンプレ・配信' },
  { href: '/ma', label: 'MA' },
  { href: '/forms', label: 'フォーム' },
] as const

export function LineMaNav({
  projectId,
  serviceId,
}: {
  projectId: string
  serviceId: string
}) {
  const pathname = usePathname()
  const base = `/projects/${projectId}/services/${serviceId}/line-ma`

  return (
    <div className="flex flex-wrap items-center gap-1 mb-6 border-b border-gray-200">
      {NAV.map((item) => {
        const full = item.href === '' ? base : `${base}${item.href}`
        const active =
          item.href === ''
            ? pathname === base || pathname === `${base}/`
            : pathname.startsWith(`${base}${item.href}`)
        return (
          <Link
            key={item.href || 'root'}
            href={full}
            className={`px-3 py-2.5 text-sm font-medium -mb-px border-b-2 transition ${
              active
                ? 'text-green-600 border-green-600'
                : 'text-gray-500 hover:text-gray-700 border-transparent'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

export function LineMaBreadcrumb({
  projectId,
  serviceId,
  projectName,
  serviceName,
  extra,
}: {
  projectId: string
  serviceId: string
  projectName: string
  serviceName: string
  extra?: string
}) {
  return (
    <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
      <Link href="/projects" className="hover:text-purple-600">
        プロジェクト
      </Link>
      <span>›</span>
      <Link href={`/projects/${projectId}`} className="hover:text-purple-600">
        {projectName || '...'}
      </Link>
      <span>›</span>
      <Link
        href={`/projects/${projectId}/services/${serviceId}/integrations`}
        className="hover:text-purple-600"
      >
        {serviceName || '...'}
      </Link>
      <span>›</span>
      <span className="text-gray-700 font-medium">LINE Messaging MA{extra ? ` › ${extra}` : ''}</span>
    </nav>
  )
}
