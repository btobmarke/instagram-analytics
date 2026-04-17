import Link from 'next/link'
import { ManualPage, Section, Table, InfoBox } from '../_components/ManualPage'

const GROUPS = [
  { href: '/manual/batches/instagram', label: 'Instagram', desc: '投稿・インサイト・アカウント・ストーリー・KPI・AI分析' },
  { href: '/manual/batches/lp', label: 'LP / MA', desc: 'LP 集計・セッションクリーンアップ' },
  { href: '/manual/batches/ga4', label: 'GA4', desc: 'GA4 Data API からの日次データ収集' },
  { href: '/manual/batches/clarity', label: 'Clarity', desc: 'Clarity Export API からの日次データ収集' },
  { href: '/manual/batches/gbp', label: 'GBP', desc: 'GBP Performance API の日次＋レビュー同期' },
  { href: '/manual/batches/line', label: 'LINE OAM', desc: 'CSV エクスポート取り込み' },
  { href: '/manual/batches/google-ads', label: 'Google 広告', desc: 'キャンペーン・広告グループ・キーワード' },
  { href: '/manual/batches/external', label: '外部データ', desc: '天気・祝日同期' },
  { href: '/manual/batches/system', label: 'システム', desc: 'トークン更新・横断サマリーキャッシュ' },
]

export default function BatchesOverview() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 媒体別 バッチスケジュール"
      title="媒体別 バッチスケジュール"
      description="本システムが定期実行している各バッチについて、どの媒体のどの値を何時に取りに行くかを媒体別にまとめています。スケジュール表記はすべて JST です。"
    >
      <InfoBox tone="info" title="実行基盤">
        バッチは Vercel Cron（UTC）で起動され、<code>/api/batch/*</code> ルートが実体の処理を行います。本ページでは運用者向けに <strong>JST（日本標準時）</strong> で表記しています。手動実行はサイドメニュー「バッチ管理」画面から可能です。
      </InfoBox>

      <Section title="全体俯瞰（JST）">
        <Table
          head={['時刻(JST)', '媒体', 'バッチ']}
          rows={[
            ['02:00', '外部データ', '昨日分 天気・祝日（external-data） ※UTC 17:00'],
            ['06:00', 'システム', '横断サマリーキャッシュ（project-metrics-aggregate） ※UTC 21:00'],
            ['09:00 / 21:00', '外部データ', '天気・祝日 同期（weather-sync） ※UTC 00:00/12:00'],
            ['11:00', 'LP / MA', 'LP 集計（lp-aggregate） ※UTC 02:00'],
            ['11:15', 'Google 広告', '日次収集（google-ads-daily） ※UTC 02:15'],
            ['11:30', 'Instagram', '投稿一覧同期（media-collector） ※UTC 02:30'],
            ['12:15', 'GA4', '日次収集（ga4-collector） ※UTC 03:15'],
            ['12:45', 'Clarity', '日次収集（clarity-collector） ※UTC 03:45'],
            ['13:00', 'GBP', '日次収集（gbp-daily） ※UTC 04:00'],
            ['13:30', 'LINE OAM', '日次収集（line-oam-daily） ※UTC 04:30'],
            ['月曜 15:00', 'Instagram', '週次AI分析（ai-analysis） ※UTC 月曜 06:00'],
            ['毎時 :00', 'Instagram', '投稿インサイト取得（insight-collector）'],
            ['毎時 :10', 'Instagram', 'ストーリーインサイト（story-insight-collector）'],
            ['毎時 :45', 'Instagram', 'KPI再計算（kpi-calc）'],
            ['30分毎', 'LP / MA', 'セッションクリーンアップ（lp-session-cleanup）'],
          ]}
        />
      </Section>

      <Section title="媒体別の詳細">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {GROUPS.map(g => (
            <Link
              key={g.href}
              href={g.href}
              className="group block border border-gray-200 rounded-2xl p-4 hover:border-purple-300 hover:shadow-md transition"
            >
              <p className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">{g.label}</p>
              <p className="text-xs text-gray-500 leading-relaxed mt-1">{g.desc}</p>
            </Link>
          ))}
        </div>
      </Section>
    </ManualPage>
  )
}
