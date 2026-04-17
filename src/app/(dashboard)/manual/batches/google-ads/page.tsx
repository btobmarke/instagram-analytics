import { ManualPage, Section, Table, Code, InfoBox } from '../../_components/ManualPage'

export default function GoogleAdsBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › Google 広告"
      title="Google 広告 バッチスケジュール"
      description="Google 広告連携バッチの実行時刻（JST）と取得内容です。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '取得する値']}
          rows={[
            ['11:15（毎日）', 'google-ads-daily', '/api/batch/google-ads-daily', 'キャンペーン別・広告グループ別・（ON 時）キーワード別の日次指標：表示回数・クリック・費用・コンバージョン・コンバージョン値'],
          ]}
        />
      </Section>

      <Section title="取得対象">
        <ul className="list-disc pl-5 space-y-1">
          <li>Google 広告サービスが登録され、顧客 ID が保存されていること。</li>
          <li><Code>is_active = true</Code> のサービスのみ対象。</li>
          <li>初回または <Code>backfill_days</Code> が指定されている場合は、過去 N 日を遡って取得。</li>
          <li><Code>collect_keywords = true</Code> の場合のみ、キーワード別クエリを追加実行。</li>
        </ul>
      </Section>

      <Section title="処理の流れ">
        <ol className="list-decimal pl-5 space-y-1">
          <li>環境変数の開発者トークン・OAuth リフレッシュトークンでアクセストークンを取得。</li>
          <li>サービスごとに顧客 ID を切り替えて Google Ads Query Language (GAQL) を発行。</li>
          <li>キャンペーン／広告グループ／（任意で）キーワード単位で GAQL を3〜4本実行。</li>
          <li>取得結果を <Code>google_ads_campaign_daily</Code> 等のテーブルにアップサート。</li>
          <li>通貨コード・タイムゾーンは <Code>customer.currency_code</Code>・<Code>customer.time_zone</Code> から取得・保存。</li>
        </ol>
      </Section>

      <InfoBox tone="info">
        Google 広告の日次データは計測の仕様上、当日分が翌日以降に確定します。そのため前日分までを毎朝取り直すように設計されています。
      </InfoBox>
    </ManualPage>
  )
}
