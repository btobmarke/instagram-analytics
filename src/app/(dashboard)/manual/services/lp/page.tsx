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

      <Section title="LpMA 推奨カスタムイベント（セクション到達）">
        <p>
          LP 側の計測タグ（<Code>LpMA.track</Code> / 自前の <Code>fetch</Code> でも可）で、スクロールにより「どのセクションがビューポートに入ったか」を残す場合は、次の契約に揃えるとダッシュボードのセッション詳細で要約・タイムライン表示されます。
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2 text-sm">
          <li><strong>event_id</strong>：<Code>section_in_view</Code>（固定文字列）</li>
          <li><strong>meta</strong>：<Code>{'{ section_id: string }'}</Code> 必須。任意で <Code>section_name</Code>（表示用ラベル）を付与可能。</li>
        </ul>
        <p className="mt-3 text-sm text-gray-600">
          同一セクションで連続送信されても、セッション詳細の「到達したセクション」一覧は <strong>各 <Code>section_id</Code> の初回のみ</strong>を順序付きで表示します（タイムライン上は従来どおり全件）。
        </p>
        <pre className="mt-3 bg-gray-900 text-gray-100 text-xs font-mono p-4 rounded-xl overflow-x-auto leading-relaxed">
{`// lp-sdk.js 利用時（推奨）
LpMA.trackSectionInView('pricing');
LpMA.trackSectionInView('pricing', '料金');

// または LpMA.track と同一ペイロード
LpMA.track('section_in_view', { section_id: 'pricing' });`}
        </pre>
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
