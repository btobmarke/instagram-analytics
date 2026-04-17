import Link from 'next/link'
import { ManualPage, Section, InfoBox } from '../_components/ManualPage'

const SERVICES = [
  { href: '/manual/services/instagram', label: 'Instagram', emoji: '📸', desc: 'アカウント分析、投稿一覧、投稿インサイト、AI分析' },
  { href: '/manual/services/lp', label: 'ランディングページ', emoji: '🎯', desc: 'GA4・Clarity を統合した LP 計測・ユーザー／セッション分析' },
  { href: '/manual/services/line', label: 'LINE OAM', emoji: '💬', desc: 'フレンド数・属性・ショップカード・リワードカード取引履歴' },
  { href: '/manual/services/gbp', label: 'Googleビジネスプロフィール', emoji: '🏢', desc: '検索経由のアクセス・経路案内・電話・レビューの収集と分析' },
  { href: '/manual/services/google-ads', label: 'Google 広告', emoji: '🔍', desc: 'キャンペーン／広告グループ／キーワードの日次パフォーマンス' },
  { href: '/manual/services/sales', label: '売上分析', emoji: '💰', desc: '商品マスター・売上明細を元にした売上ダッシュボード' },
  { href: '/manual/services/summary', label: 'サマリー', emoji: '📋', desc: '複数サービスを一枚にまとめる任意テンプレートのレポート' },
]

export default function ServicesOverviewManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › サービス詳細"
      title="サービス詳細 機能解説"
      description="プロジェクト配下に登録できる各「サービス」について、画面構成・機能・データソースを解説します。左メニューまたは下のカードから該当サービスを選択してください。"
    >
      <Section title="サービスとは">
        <p>
          本システムでは、1 つのクライアント配下に複数のプロジェクトを持ち、さらにその配下に「サービス」を登録することで、媒体ごとの計測を行います。サービス種別ごとに表示されるタブ・分析機能が異なります。
        </p>
        <InfoBox tone="info">
          サービスには共通して <strong>設定／連携</strong> タブがあり、ここで外部媒体の ID・トークン・サービスアカウント JSON 等を登録します。設定値の取得方法は「媒体別 設定取得ガイド」を参照してください。
        </InfoBox>
      </Section>

      <Section title="サービス一覧">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SERVICES.map(s => (
            <Link
              key={s.href}
              href={s.href}
              className="group block border border-gray-200 rounded-2xl p-4 hover:border-purple-300 hover:shadow-md transition"
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xl">{s.emoji}</span>
                <p className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">{s.label}</p>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
            </Link>
          ))}
        </div>
      </Section>
    </ManualPage>
  )
}
