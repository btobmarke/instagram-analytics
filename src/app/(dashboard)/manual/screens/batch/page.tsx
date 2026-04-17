import { ManualPage, Section, StepList, InfoBox, Code, Table } from '../../_components/ManualPage'

export default function ScreenBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 画面別 › バッチ管理画面"
      title="バッチ管理画面"
      description="サイドメニュー「バッチ管理」から遷移する画面で、各媒体のデータ取得ジョブの実行状況を一覧で確認したり、手動で再実行したりできます。"
    >
      <Section title="画面でできること">
        <ul className="list-disc pl-5 space-y-1">
          <li>定期実行されているバッチの一覧と、最終実行日時・ステータスの確認</li>
          <li>ログ（実行履歴）のフィルタ・絞り込み表示</li>
          <li>CRON_SECRET を指定してのバッチ手動実行</li>
          <li>集計キャッシュ（<Code>project_metrics_daily</Code>）の日付範囲指定による再構築</li>
        </ul>
      </Section>

      <Section title="画面の見方">
        <Table
          head={['UI要素', '内容']}
          rows={[
            ['カテゴリバッジ', 'Instagram / LP・MA / GA4 / Clarity / GBP / LINE OAM / Google広告 / 外部データ / システム を色分け。'],
            ['ジョブ名', 'バッチの日本語ラベルとシステム名、及び処理内容の説明。'],
            ['頻度', '毎時 / 毎日 / 毎週 / 毎月 など、定期実行のスケジュール。'],
            ['最終実行', '最後に実行完了した日時（JST）。'],
            ['ステータス', 'running / success / partial / failed のいずれか。'],
            ['手動実行', 'CRON_SECRET 入力後、該当行の実行ボタンをクリックで即時再実行。'],
          ]}
        />
      </Section>

      <Section title="手動実行の手順">
        <StepList
          steps={[
            <>画面上部の入力欄に <Code>CRON_SECRET</Code> を貼り付けます（未入力では実行できません）。</>,
            <>再実行したいジョブ行の <Code>実行</Code> ボタンをクリックします。</>,
            <>完了後、ログ行に結果が追記され、件数・失敗件数などが表示されます。</>,
          ]}
        />
        <InfoBox tone="warn" title="CRON_SECRET について">
          Vercel の環境変数に登録されているシークレット文字列です。画面には保存されないため、都度入力が必要です。共有時は取扱に注意してください。
        </InfoBox>
      </Section>

      <Section title="キャッシュ再構築">
        <p>
          画面下部の「キャッシュ再構築」セクションで、<Code>project_metrics_daily</Code> を日付範囲で再集計できます。バッチ実行漏れや、集計ロジック変更後のリカバリに使用します。デフォルトは JST の昨日分のみです。
        </p>
      </Section>

      <Section title="詳細な仕様が知りたい場合">
        <p>
          媒体ごとの具体的なバッチ名・取得データ・スケジュールの詳細は「媒体別 バッチスケジュール」セクションを参照してください。
        </p>
      </Section>
    </ManualPage>
  )
}
