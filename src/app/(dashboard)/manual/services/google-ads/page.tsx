import { ManualPage, Section, Table, InfoBox, Code } from '../../_components/ManualPage'

export default function GoogleAdsServiceManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › サービス詳細 › Google 広告"
      title="Google 広告サービス"
      description="Google Ads API と連携し、キャンペーン・広告グループ・キーワード別の日次パフォーマンスを収集・可視化するサービスです。"
    >
      <Section title="画面構成（タブ）">
        <Table
          head={['タブ', 'パス', '機能']}
          rows={[
            ['ダッシュボード', '/google-ads/analytics', '選択期間の費用・表示回数・クリック・CVR・CPA・ROASを時系列・セグメント別に表示。'],
            ['AI', '/google-ads/ai', '期間サマリーに対する Claude のコメント。'],
            ['AIチャット', '/google-ads/ai/chat', '広告パフォーマンスを Claude に対話形式で質問できるチャット。'],
            ['設定', '/google-ads/settings', '顧客ID、通貨、タイムゾーン、キーワード収集の ON/OFF、バックフィル日数を設定。'],
          ]}
        />
      </Section>

      <Section title="取得するデータ">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>キャンペーン単位</strong>：表示回数・クリック数・費用・コンバージョン・コンバージョン値。</li>
          <li><strong>広告グループ単位</strong>：同上の指標を広告グループ単位で集計。</li>
          <li><strong>キーワード単位</strong>：<Code>collect_keywords = true</Code> の場合のみ収集。件数が多いため既定では OFF。</li>
        </ul>
      </Section>

      <Section title="サービスに紐づく設定項目">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>顧客ID（Customer ID）</strong>：10 桁のハイフンなし数字。</li>
          <li><strong>バックフィル日数</strong>：初回接続時に遡って取得する日数（最大 90 日）。</li>
          <li><strong>collect_keywords</strong>：キーワード単位のデータを収集するかどうか。</li>
        </ul>
      </Section>

      <InfoBox tone="info">
        Google Ads API は開発者トークン・OAuth 同意が必要です。具体的な取得手順は「媒体別 設定取得ガイド ＞ Google 広告」を参照してください。
      </InfoBox>
    </ManualPage>
  )
}
