import { ManualPage, Section, Table, InfoBox, Code } from '../../_components/ManualPage'

export default function SummaryServiceManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › サービス詳細 › サマリー"
      title="サマリーサービス"
      description="複数のサービスから取得した指標を 1 枚のテンプレートにまとめて表示するサービスです。クライアント報告書や月次レビューの素材として利用します。"
    >
      <Section title="画面構成">
        <Table
          head={['タブ', 'パス', '機能']}
          rows={[
            ['テンプレート一覧', '/summary', 'このサービスに紐づくサマリー・テンプレート（週次／月次／任意）を管理。'],
            ['テンプレート編集', '/summary/:templateId', 'ブロック（セクション）を追加し、参照するサービスと指標を選択して構成。'],
            ['テンプレート表示', '/summary/:templateId/view', '編集中のテンプレートのプレビューと PDF／印刷用レイアウト。'],
          ]}
        />
      </Section>

      <Section title="主要機能">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>カタログ</strong>：利用可能なブロック（Instagram KPI、GA4 イベント、GBP 指標、売上サマリーなど）の一覧。</li>
          <li><strong>データソース</strong>：各ブロックは <Code>project_metrics_daily</Code> または対応サービスの生テーブルを参照。</li>
          <li><strong>期間指定</strong>：週次／月次／任意の開始・終了日でレンダリング。</li>
        </ul>
      </Section>

      <InfoBox tone="info">
        プロジェクト画面の「統合サマリー」はサマリーサービスとは別に、プロジェクト全体を俯瞰するビューです。サマリーサービスは「テンプレートで自由に組み替えられるレポート」を意図しています。
      </InfoBox>
    </ManualPage>
  )
}
