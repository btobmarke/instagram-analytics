import { ManualPage, Section, Table, Code, InfoBox } from '../../_components/ManualPage'

export default function SystemBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › システム"
      title="システムバッチスケジュール"
      description="媒体横断で動作する、システム運用系バッチの一覧です。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '処理内容']}
          rows={[
            ['06:00（毎日）', 'project-metrics-aggregate', '/api/batch/project-metrics-aggregate', '全サービスの日次指標を project_metrics_daily にまとめてキャッシュ。統合サマリー／サマリーサービスの表示速度を担保する'],
            ['日次（ポーリング）', 'daily_token_refresh', '（内部処理：insight-collector に内包）', 'Instagram Long-Lived Token（有効期限60日）を自動更新。期限 20 日以内のトークンが対象'],
          ]}
        />
      </Section>

      <Section title="横断サマリーキャッシュ（project-metrics-aggregate）">
        <ol className="list-decimal pl-5 space-y-1">
          <li>全プロジェクトをループ。</li>
          <li>サービスごとの日次サマリーテーブル（Instagram・LP・GA4・Clarity・GBP・LINE・Google広告・売上）を読み取り。</li>
          <li>共通スキーマに変換して <Code>project_metrics_daily</Code> にアップサート。</li>
          <li>再構築が必要な場合は、バッチ管理画面の「キャッシュ再構築」から日付範囲を指定して再実行可能。</li>
        </ol>
      </Section>

      <Section title="トークン更新">
        <ul className="list-disc pl-5 space-y-1">
          <li>対象：Instagram Graph API の Long-Lived Token（有効期限 60 日）。</li>
          <li>期限 20 日以内のトークンを <Code>GET /oauth/access_token?grant_type=ig_refresh_token</Code> で更新。</li>
          <li>更新失敗時はアカウントを <Code>disconnected</Code> に変更し、UI にアラートを表示。</li>
        </ul>
      </Section>

      <InfoBox tone="tip">
        バッチ実行ログはすべて <Code>batch_job_logs</Code> テーブルに保存されます。失敗時は画面のログ一覧で詳細メッセージを確認してください。
      </InfoBox>
    </ManualPage>
  )
}
