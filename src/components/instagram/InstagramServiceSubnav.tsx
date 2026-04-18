'use client'

import Link from 'next/link'

export type InstagramServiceTab =
  | 'analytics'
  | 'posts'
  | 'like-users'
  | 'ai'
  | 'settings'
  | 'kpi-settings'
  | 'summary'

const tabDefs: { key: InstagramServiceTab; label: string; path: string }[] = [
  { key: 'analytics', label: 'ダッシュボード', path: '/instagram/analytics' },
  { key: 'posts', label: '投稿一覧', path: '/instagram/posts' },
  { key: 'like-users', label: 'いいねユーザー', path: '/instagram/like-users' },
  { key: 'ai', label: 'AI分析', path: '/instagram/ai' },
  { key: 'settings', label: '設定', path: '/instagram' },
  { key: 'kpi-settings', label: 'KPI設定', path: '/instagram/kpi-settings' },
  { key: 'summary', label: 'サマリー', path: '/summary' },
]

type InstagramServiceSubnavProps = {
  projectId: string
  serviceId: string
  active: InstagramServiceTab
  className?: string
}

/** Instagram サービス配下の共通タブ（ダッシュボード / 投稿 / いいねユーザー / AI / 設定 / KPI設定 / サマリー） */
export function InstagramServiceSubnav({ projectId, serviceId, active, className }: InstagramServiceSubnavProps) {
  const base = `/projects/${projectId}/services/${serviceId}`
  const wrap = className ?? 'mb-6 border-b border-gray-200'
  return (
    <div className={`flex flex-wrap items-center gap-1 ${wrap}`}>
      {tabDefs.map((t) => {
        const href = `${base}${t.path}`
        const isActive = active === t.key
        return (
          <Link
            key={t.key}
            href={href}
            className={
              isActive
                ? 'px-4 py-2.5 text-sm font-medium text-pink-600 border-b-2 border-pink-600 -mb-px'
                : 'px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition'
            }
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
