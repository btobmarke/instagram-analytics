import Link from 'next/link'
import { ManualPage, Section, InfoBox } from '../_components/ManualPage'

const MEDIA = [
  { href: '/manual/integrations/instagram', label: 'Instagram', desc: 'Meta Business で Long-Lived Token・IG ユーザー ID を取得' },
  { href: '/manual/integrations/ga4', label: 'Google Analytics 4', desc: 'プロパティ ID・サービスアカウント JSON の取得' },
  { href: '/manual/integrations/clarity', label: 'Microsoft Clarity', desc: 'プロジェクト ID・Export API キーの取得' },
  { href: '/manual/integrations/line', label: 'LINE OAM', desc: 'Bot ID・リワードカード ID と URL テンプレートの確認' },
  { href: '/manual/integrations/gbp', label: 'Googleビジネス', desc: 'Google アカウント認可とロケーション選択' },
  { href: '/manual/integrations/google-ads', label: 'Google広告', desc: '顧客 ID・開発者トークン・OAuth 認可の取得' },
]

export default function IntegrationsOverview() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 媒体別 設定取得ガイド"
      title="媒体別 設定取得ガイド"
      description="各サービス詳細の「設定／連携」タブに入力する ID・トークン・JSON 等を、媒体側のどの画面で取得するか媒体ごとにまとめています。"
    >
      <InfoBox tone="info">
        本ガイドは「媒体側の管理画面で何をすれば必要な値が手に入るか」に焦点を当てています。入力後の挙動・データ取得頻度は「サービス詳細 機能解説」や「媒体別 バッチスケジュール」を参照してください。
      </InfoBox>

      <Section title="媒体一覧">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MEDIA.map(m => (
            <Link
              key={m.href}
              href={m.href}
              className="group block border border-gray-200 rounded-2xl p-4 hover:border-purple-300 hover:shadow-md transition"
            >
              <p className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">{m.label}</p>
              <p className="text-xs text-gray-500 leading-relaxed mt-1">{m.desc}</p>
            </Link>
          ))}
        </div>
      </Section>
    </ManualPage>
  )
}
