import { ManualPage, Section, Table, InfoBox } from '../../_components/ManualPage'

export default function ClarityBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › Clarity"
      title="Microsoft Clarity バッチスケジュール"
      description="Microsoft Clarity 連携バッチの実行時刻（JST）と取得内容です。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '取得する値']}
          rows={[
            ['12:45（毎日）', 'clarity-collector', '/api/batch/clarity-collector', 'セッション数、スクロール深度、レイジクリック率、デッドクリック率、JS エラー件数、クイックバック率'],
          ]}
        />
      </Section>

      <Section title="取得対象">
        <p>
          サービス <code>integrations.integration_type = &apos;CLARITY&apos;</code> が有効なサービスのみ対象。API キーが失効している場合はエラー扱いでスキップされます。
        </p>
      </Section>

      <Section title="処理の流れ">
        <ol className="list-decimal pl-5 space-y-1">
          <li>登録済み Clarity 連携を取得。</li>
          <li>Export API <code>/export-data/api/v1/project-live-insights</code> を <code>numOfDays=1</code> で呼び出し、前日分のメトリクスを取得。</li>
          <li>フィルタ無し／URL別／ユーザー種別（新規・再訪）等のディメンションで複数回コール。</li>
          <li>結果を <code>clarity_daily_summary</code> にアップサート。</li>
        </ol>
      </Section>

      <InfoBox tone="warn">
        Clarity Export API は直近 <strong>3 日分</strong> のみ取得可能です。バッチが 3 日以上停止した場合、その期間のデータは復元できません。
      </InfoBox>
    </ManualPage>
  )
}
