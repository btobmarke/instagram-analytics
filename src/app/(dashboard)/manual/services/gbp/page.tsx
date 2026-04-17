import { ManualPage, Section, Table, InfoBox } from '../../_components/ManualPage'

export default function GbpServiceManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › サービス詳細 › Googleビジネス"
      title="Googleビジネスプロフィール（GBP）サービス"
      description="Google Business Profile Performance API を利用して、店舗の検索・経路案内・電話・レビュー情報を収集・可視化するサービスです。"
    >
      <Section title="画面構成（タブ）">
        <Table
          head={['タブ', 'パス', '機能']}
          rows={[
            ['トップ', '/gbp', 'Google アカウント連携、ロケーションの選択と切替。'],
            ['ダッシュボード', '/gbp/dashboard', '検索表示回数・経路案内・電話ボタン・ウェブサイトクリックの推移、検索キーワード、レビュー一覧。'],
          ]}
        />
      </Section>

      <Section title="収集する指標">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>日次指標</strong>：検索・マップでのインプレッション、ウェブサイトクリック、電話クリック、経路案内クリック。</li>
          <li><strong>検索キーワード</strong>：月次集計の検索クエリ別インプレッション（GBP の API は月単位提供のため）。</li>
          <li><strong>レビュー</strong>：星評価、レビュー本文、返信、投稿日時を同期。</li>
        </ul>
      </Section>

      <Section title="サービスに紐づく設定項目">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Google アカウント認可</strong>：OAuth 経由で GBP のロケーションへアクセス権を付与。</li>
          <li><strong>ロケーション選択</strong>：認可済みアカウントから取得した店舗一覧から対象を選択し、ロケーション名で紐づけ。</li>
        </ul>
      </Section>

      <InfoBox tone="info">
        1 つのサービスに 1 ロケーションを紐付けます。複数店舗を計測したい場合は、プロジェクト配下にサービスを複数登録してください。
      </InfoBox>
    </ManualPage>
  )
}
