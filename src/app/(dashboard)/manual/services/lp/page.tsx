import { ManualPage, Section, Table, InfoBox, Code } from '../../_components/ManualPage'

export default function LpServiceManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › サービス詳細 › ランディングページ"
      title="ランディングページ（LP）サービス"
      description="Google Analytics 4 と Microsoft Clarity を統合した LP 計測サービスです。セッション／ユーザー／イベント／ページ／外部流入／HOTセッションを一画面で把握できます。"
    >
      <Section title="画面構成（タブ）">
        <Table
          head={['タブ', 'パス', '機能']}
          rows={[
            ['サマリー', '/lp', '期間指定（今日／7日／30日／全期間）でセッション・ユーザー・平均滞在・HOT率を表示。'],
            ['GA4', '/lp/ga4', 'GA4 由来のイベント・ページ別・トラフィックソース・デバイス・地域ランキング。'],
            ['Clarity', '/lp/clarity', 'スクロール深度・レイジクリック・デッドクリック・JS エラーの集計。'],
            ['セッション一覧', '/lp/sessions', '個別セッションの詳細を参照。Clarityのリプレイに相当する要約情報。'],
            ['ユーザー一覧', '/lp/users', 'MA クッキーベースでユーザーをまとめ、再訪状況や HOT 判定を表示。'],
            ['イベント', '/lp/events', '任意のカスタムイベント（CV等）の発火数を集計。'],
            ['設定／連携', '/integrations', 'GA4 プロパティ ID／サービスアカウント JSON、Clarity プロジェクト ID／APIキーを登録。'],
          ]}
        />
      </Section>

      <Section title="サービスに紐づく設定項目">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>LP_ID</strong>：計測タグのスクリプトや MA 連携で利用する一意のコード。サービス登録時に入力します。</li>
          <li><strong>対象URL</strong>：集計の対象となる LP の URL。</li>
          <li><strong>GA4 プロパティID</strong>：GA4 Data API を呼び出すプロパティ ID。</li>
          <li><strong>Clarity プロジェクトID／APIキー</strong>：Export API を呼び出すためのクレデンシャル。</li>
        </ul>
      </Section>

      <Section title="HOT セッションとは">
        <p>
          一定の行動（滞在時間・CVイベント発火・スクロール到達など）を満たしたセッションを「HOT」と判定する独自指標です。HOT 率はマーケ施策の質を測る指標として利用します。閾値は <Code>project_metrics_daily</Code> 集計時に適用されます。
        </p>
      </Section>

      <InfoBox tone="info">
        GA4 / Clarity の両方、もしくは片方だけ連携することも可能です。連携設定がない媒体のタブは空で表示されます。
      </InfoBox>
    </ManualPage>
  )
}
