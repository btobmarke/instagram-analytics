import { ManualPage, Section, Table, InfoBox } from '../../_components/ManualPage'

export default function SalesServiceManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › サービス詳細 › 売上分析"
      title="売上分析サービス"
      description="商品マスターと売上明細（取引履歴）を取り込み、売上高・客単価・購入者数・リピート状況などを可視化するサービスです。"
    >
      <Section title="画面構成（タブ）">
        <Table
          head={['タブ', 'パス', '機能']}
          rows={[
            ['ダッシュボード', '/sales/dashboard', '売上高・購入者数・平均単価の時系列、商品ランキング、前期比を表示。'],
            ['商品', '/sales/products', '商品マスターの CRUD（商品コード・商品名・価格・カテゴリ）。'],
            ['売上明細', '/sales/records', '売上明細（注文日・商品・数量・金額）の登録と一覧。CSV インポート対応。'],
          ]}
        />
      </Section>

      <Section title="データモデル">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>商品マスター</strong>：商品単位の属性を保持。売上明細と商品コードで JOIN。</li>
          <li><strong>売上明細</strong>：1 行 1 明細。複数行をまとめて 1 件の注文として集計も可能。</li>
          <li><strong>日次サマリー</strong>：<strong>project_metrics_daily</strong> にキャッシュされ、統合サマリーから参照されます。</li>
        </ul>
      </Section>

      <InfoBox tone="tip">
        売上データは外部 API と接続していないため、CSV 取り込み／手入力が基本です。定期的なインポートをバッチ化する場合は、運用側でスクリプトを用意してください。
      </InfoBox>
    </ManualPage>
  )
}
