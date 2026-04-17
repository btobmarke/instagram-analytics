import { ManualPage, Section, Table, Code, InfoBox } from '../../_components/ManualPage'

export default function Ga4BatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › GA4"
      title="GA4 バッチスケジュール"
      description="Google Analytics 4 連携バッチの実行時刻（JST）と取得内容です。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '取得する値']}
          rows={[
            ['12:15（毎日）', 'ga4-collector', '/api/batch/ga4-collector', 'セッション数・ページビュー・コンバージョン数・平均エンゲージメント時間、トラフィックソース（ソース/メディア/キャンペーン）、デバイス種別、地域（国・都市）、イベント別発火数'],
          ]}
        />
      </Section>

      <Section title="取得対象">
        <p>
          サービス <Code>integrations.integration_type = 'GA4'</Code> が登録され、サービスアカウントの閲覧権限が有効なサービスのみ対象。複数サービスは順次処理します。
        </p>
      </Section>

      <Section title="処理の流れ">
        <ol className="list-decimal pl-5 space-y-1">
          <li>登録済み GA4 連携を取得。</li>
          <li>サービスアカウント JSON で Google Analytics Data API に認証。</li>
          <li>前日分（JST）を対象に <Code>runReport</Code> を複数ディメンション（基本・ソース・デバイス・地域・イベント）で実行。</li>
          <li>取得結果を <Code>ga4_daily_*</Code> 系テーブルにアップサート。</li>
          <li>最後に <Code>integrations.last_synced_at</Code> を更新。</li>
        </ol>
      </Section>

      <InfoBox tone="info">
        GA4 Data API には同時実行クォータが設定されています。エラー <Code>RESOURCE_EXHAUSTED</Code> が返った場合はバッチが指数バックオフで再試行し、それでも失敗した場合は翌日分にマージされます。
      </InfoBox>
    </ManualPage>
  )
}
