import { ManualPage, Section, Table, InfoBox } from '../../_components/ManualPage'

export default function GbpBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › GBP"
      title="Googleビジネスプロフィール バッチスケジュール"
      description="Google Business Profile 連携バッチの実行時刻（JST）と取得内容です。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '取得する値']}
          rows={[
            ['13:00（毎日）', 'gbp-daily', '/api/batch/gbp-daily', 'ビジネスプロフィールの検索・マップ別インプレッション、ウェブサイトクリック、電話ボタン、経路案内クリック、検索キーワード別月次インプレッション、レビュー（星数／本文／投稿日時／返信）'],
          ]}
        />
      </Section>

      <Section title="取得対象">
        <p>
          GBP ロケーションが紐付いており、OAuth 認可が <code>active</code> のサービスのみ対象です。
        </p>
      </Section>

      <Section title="処理の流れ">
        <ol className="list-decimal pl-5 space-y-1">
          <li>OAuth リフレッシュトークンでアクセストークンを更新。</li>
          <li>Performance API <code>locations.fetchMultiDailyMetricsTimeSeries</code> で日次メトリクスを取得（前日分）。</li>
          <li>Performance API <code>searchkeywords:impressions</code> で月次の検索キーワード（当月・前月）を取得。</li>
          <li>Business Information API の <code>reviews.list</code> でレビューを同期。</li>
          <li>結果を <code>gbp_daily_metrics</code>、<code>gbp_search_keywords</code>、<code>gbp_reviews</code> にアップサート。</li>
        </ol>
      </Section>

      <InfoBox tone="info">
        検索キーワードは Google 側の仕様で <strong>月次提供</strong> のため、当月分は毎日上書き更新され、月初の2〜3営業日以内に前月分が確定します。
      </InfoBox>
    </ManualPage>
  )
}
