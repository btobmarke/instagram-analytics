import { ManualPage, Section, StepList, InfoBox, Code, Table } from '../../_components/ManualPage'

export default function GbpIntegrationGuide() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 設定取得ガイド › GBP"
      title="Googleビジネスプロフィール 設定の取得方法"
      description="GBP サービスで行う Google アカウントの認可と、ロケーション（店舗）選択の手順を解説します。"
    >
      <Section title="必要な値">
        <Table
          head={['項目', '入力欄', '取得先']}
          rows={[
            ['Google アカウント', 'GBPサービス > Google 連携ボタン', '対象の GBP ロケーションを「オーナー」または「管理者」権限で管理している Google アカウント'],
            ['ロケーション名', 'GBPサービス > ロケーション選択モーダル', '認可済みアカウント配下から取得されるロケーション一覧で選択'],
          ]}
        />
      </Section>

      <Section title="事前準備">
        <ul className="list-disc pl-5 space-y-1">
          <li>対象店舗が Google Business Profile で登録済みで、ビジネス認証が完了していること。</li>
          <li>連携に使用する Google アカウントが、そのロケーションの <strong>オーナー</strong> または <strong>管理者</strong> に含まれていること。</li>
          <li>Google Cloud Console 側の OAuth 同意画面・Business Profile API 有効化は、本システム運営側で実施済みです（クライアント毎の作業は不要）。</li>
        </ul>
      </Section>

      <Section title="連携手順">
        <StepList
          steps={[
            <>GBP サービスのトップ画面で <Code>Google と連携</Code> ボタンをクリックします。</>,
            <>ポップアップで対象の Google アカウントを選択し、<strong>Business Profile の管理</strong> に関するスコープを許可します。</>,
            <>画面に戻ったら <Code>ロケーションを選択</Code> を押し、表示されたロケーション一覧から対象店舗を選んで保存します。</>,
            <>「連携中」ステータスになれば完了です。以降は <Code>gbp_daily</Code> バッチが自動でデータを取得します。</>,
          ]}
        />
      </Section>

      <Section title="再認可が必要なとき">
        <ul className="list-disc pl-5 space-y-1">
          <li>連携 Google アカウントのパスワード変更・二段階認証再発行後。</li>
          <li>オーナー権限がはずれた／変更された場合。</li>
          <li>ロケーションの統合・削除が行われた場合。</li>
        </ul>
      </Section>

      <InfoBox tone="info">
        検索キーワード指標は Google 側が月次でしか提供していません。そのため該当タブには前月分までが表示され、当月分は翌月初に更新されます。
      </InfoBox>
    </ManualPage>
  )
}
