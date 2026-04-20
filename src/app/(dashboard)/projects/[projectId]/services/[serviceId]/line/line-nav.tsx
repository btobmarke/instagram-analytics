'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type LineMaCategoryId = 'connect' | 'audience' | 'delivery' | 'experience' | 'booking'

const CATEGORIES: { id: LineMaCategoryId; label: string }[] = [
  { id: 'connect', label: '接続・連携' },
  { id: 'audience', label: 'オーディエンス' },
  { id: 'delivery', label: '配信・MA' },
  { id: 'experience', label: '体験・計測' },
  { id: 'booking', label: '予約' },
]

const SUB_NAV: Record<LineMaCategoryId, { href: string; label: string }[]> = {
  connect: [
    { href: '/dashboard', label: 'ダッシュボード' },
    { href: '/connection', label: '接続（認証）' },
    { href: '/integrations', label: '外部連携' },
  ],
  audience: [
    { href: '/contacts', label: 'コンタクト' },
    { href: '/crm', label: 'タグ・属性・セグメント' },
  ],
  delivery: [
    { href: '/broadcast', label: 'テンプレ・配信' },
    { href: '/ma', label: 'MA' },
    { href: '/forms', label: 'フォーム' },
  ],
  experience: [
    { href: '/rich-menu', label: 'リッチ・postback' },
    { href: '/flex', label: 'Flex' },
    { href: '/analytics', label: '分析' },
  ],
  booking: [{ href: '/booking', label: '予約' }],
}

const CATEGORY_DEFAULT_HREF: Record<LineMaCategoryId, string> = {
  connect: '/dashboard',
  audience: '/contacts',
  delivery: '/broadcast',
  experience: '/rich-menu',
  booking: '/booking',
}

export function getCategoryFromLinePath(subPath: string): LineMaCategoryId {
  const p = subPath === '' ? '/' : subPath.startsWith('/') ? subPath : `/${subPath}`
  if (p === '/' || p === '') return 'connect'
  if (p.startsWith('/dashboard') || p.startsWith('/connection')) return 'connect'
  if (p.startsWith('/integrations')) return 'connect'
  if (p.startsWith('/contacts')) return 'audience'
  if (p.startsWith('/crm')) return 'audience'
  if (p.startsWith('/broadcast') || p.startsWith('/ma') || p.startsWith('/forms')) return 'delivery'
  if (p.startsWith('/rich-menu') || p.startsWith('/flex') || p.startsWith('/analytics')) {
    return 'experience'
  }
  if (p.startsWith('/booking')) return 'booking'
  return 'connect'
}

export function LineNav({ projectId, serviceId }: { projectId: string; serviceId: string }) {
  const pathname = usePathname()
  const base = `/projects/${projectId}/services/${serviceId}/line`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) || '/' : '/'
  const subPath = rest === '' ? '/' : rest

  const activeCategory = getCategoryFromLinePath(subPath === '/' ? '' : subPath)
  const subItems = SUB_NAV[activeCategory]

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-0.5">
        {CATEGORIES.map((cat) => {
          const defaultHref = CATEGORY_DEFAULT_HREF[cat.id]
          const full = `${base}${defaultHref}`
          const isActive = activeCategory === cat.id
          return (
            <Link
              key={cat.id}
              href={full}
              className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg transition ${
                isActive
                  ? 'bg-green-50 text-green-800 border border-b-0 border-green-200 -mb-px'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50 border border-transparent'
              }`}
            >
              {cat.label}
            </Link>
          )
        })}
      </div>

      <nav
        className="flex flex-wrap gap-1 pl-1 border-l-2 border-green-200"
        aria-label={`${CATEGORIES.find((c) => c.id === activeCategory)?.label ?? ''}のサブメニュー`}
      >
        {subItems.map((item) => {
          const full = `${base}${item.href}`
          const active =
            subPath === item.href || subPath.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={full}
              className={`px-3 py-2 text-sm font-medium rounded-md transition ${
                active
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-green-50 hover:text-green-900'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export function LineBreadcrumb({
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
      <span className="text-gray-700 font-medium">LINE{extra ? ` › ${extra}` : ''}</span>
    </nav>
  )
}
