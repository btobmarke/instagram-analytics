'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = { href: string; label: string }
type NavGroup = { title: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    title: '概要',
    items: [
      { href: '/manual', label: 'マニュアルトップ' },
    ],
  },
  {
    title: '画面別マニュアル',
    items: [
      { href: '/manual/screens/clients', label: 'クライアント画面' },
      { href: '/manual/screens/projects', label: 'プロジェクト画面' },
      { href: '/manual/screens/batch', label: 'バッチ管理画面' },
      { href: '/manual/screens/settings', label: '設定画面' },
    ],
  },
  {
    title: 'サービス詳細機能',
    items: [
      { href: '/manual/services', label: 'サービス詳細の概要' },
      { href: '/manual/services/instagram', label: 'Instagram' },
      { href: '/manual/services/lp', label: 'ランディングページ' },
      { href: '/manual/services/line', label: 'LINE OAM' },
      { href: '/manual/services/gbp', label: 'Googleビジネスプロフィール' },
      { href: '/manual/services/google-ads', label: 'Google広告' },
      { href: '/manual/services/sales', label: '売上分析' },
      { href: '/manual/services/summary', label: 'サマリー' },
    ],
  },
  {
    title: '媒体別 設定取得ガイド',
    items: [
      { href: '/manual/integrations', label: '連携設定の概要' },
      { href: '/manual/integrations/instagram', label: 'Instagram' },
      { href: '/manual/integrations/ga4', label: 'Google Analytics 4' },
      { href: '/manual/integrations/clarity', label: 'Microsoft Clarity' },
      { href: '/manual/integrations/line', label: 'LINE OAM' },
      { href: '/manual/integrations/gbp', label: 'Googleビジネス' },
      { href: '/manual/integrations/google-ads', label: 'Google広告' },
    ],
  },
  {
    title: '媒体別 バッチスケジュール',
    items: [
      { href: '/manual/batches', label: 'バッチ一覧' },
      { href: '/manual/batches/instagram', label: 'Instagram' },
      { href: '/manual/batches/lp', label: 'LP / MA' },
      { href: '/manual/batches/ga4', label: 'GA4' },
      { href: '/manual/batches/clarity', label: 'Clarity' },
      { href: '/manual/batches/gbp', label: 'GBP' },
      { href: '/manual/batches/line', label: 'LINE OAM' },
      { href: '/manual/batches/google-ads', label: 'Google広告' },
      { href: '/manual/batches/external', label: '外部データ' },
      { href: '/manual/batches/system', label: 'システム' },
    ],
  },
]

export function ManualNav() {
  const pathname = usePathname()
  return (
    <aside className="w-60 flex-shrink-0 bg-white border border-gray-200 rounded-2xl p-3 shadow-sm self-start sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
      {GROUPS.map(group => (
        <div key={group.title} className="mb-4 last:mb-0">
          <p className="px-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map(item => {
              const active = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                      active
                        ? 'bg-purple-50 text-purple-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </aside>
  )
}
