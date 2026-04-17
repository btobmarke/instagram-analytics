import { ManualPage, Section, Table, Code } from '../../_components/ManualPage'

export default function LpBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › LP / MA"
      title="LP / MA バッチスケジュール"
      description="ランディングページ（LP）関連バッチの実行時刻（JST）と取得内容です。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '処理内容']}
          rows={[
            ['11:00（毎日）', 'lp-aggregate', '/api/batch/lp-aggregate', 'LP の生イベント／セッションを集計し、セッション数・ユーザー数・HOT セッション率・平均滞在時間・ページ別・外部流入などのサマリーテーブルを更新'],
            ['30分毎', 'lp-session-cleanup', '/api/batch/lp-session-cleanup', 'アイドルでクローズされていないセッションを強制クローズ。突発切断・タブ閉じに伴うデータ欠損を防ぐ'],
          ]}
        />
      </Section>

      <Section title="集計対象">
        <ul className="list-disc pl-5 space-y-1">
          <li>本システムが発行する計測タグ経由で収集される生イベント（ページビュー、カスタムイベント、スクロール、離脱）。</li>
          <li>MA クッキーによる同一ユーザー判定。</li>
          <li>外部媒体（GA4・Clarity）由来のデータは別バッチで取り込みます（そちらのページ参照）。</li>
        </ul>
      </Section>

      <Section title="処理の流れ（lp-aggregate）">
        <ol className="list-decimal pl-5 space-y-1">
          <li>プロジェクト＋LP コードでループ。</li>
          <li>昨日 00:00〜23:59 の生イベントを抽出。</li>
          <li>セッション単位・ユーザー単位で集計し、HOT 判定・デバイス判定を付与。</li>
          <li>結果を <Code>lp_daily_summary</Code> と <Code>project_metrics_daily</Code> にアップサート。</li>
        </ol>
      </Section>
    </ManualPage>
  )
}
