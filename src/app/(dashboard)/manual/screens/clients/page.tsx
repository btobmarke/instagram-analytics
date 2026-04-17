import { ManualPage, Section, StepList, InfoBox, Code } from '../../_components/ManualPage'

export default function ScreenClientsManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 画面別 › クライアント画面"
      title="クライアント画面"
      description="サイドメニュー「クライアント」から遷移する、クライアント（取引先）単位の管理画面です。クライアントの下にプロジェクトをぶら下げ、さらにその下に各サービスを登録する、本システムの最上位のグルーピング単位になります。"
    >
      <Section title="画面でできること">
        <ul className="list-disc pl-5 space-y-1">
          <li>クライアントの一覧表示、新規作成、名称変更、削除</li>
          <li>クライアントに紐づくプロジェクトの一覧表示と切り替え</li>
          <li>クライアント配下の売上・セッション等の横断 KPI のクイックビュー</li>
        </ul>
      </Section>

      <Section title="基本操作">
        <StepList
          steps={[
            <>サイドメニューの <Code>クライアント</Code> をクリックして一覧画面を開きます。</>,
            <>右上の <Code>新規クライアント</Code> ボタンからクライアント名を登録します。</>,
            <>一覧のクライアント行をクリックすると、そのクライアントの配下のプロジェクト一覧（クライアント詳細画面）に遷移します。</>,
            <>プロジェクトをさらにクリックすることで、プロジェクト画面へ遷移できます。</>,
          ]}
        />
      </Section>

      <Section title="クライアント詳細画面の構成">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>ヘッダー</strong>：クライアント名の表示と編集ボタン。</li>
          <li><strong>プロジェクト一覧</strong>：配下プロジェクトをカード／テーブル形式で表示。ステータスや最終更新日時が確認できます。</li>
          <li><strong>プロジェクト追加</strong>：右上のボタンから、このクライアント配下に新しいプロジェクトを作成できます。</li>
        </ul>
      </Section>

      <InfoBox tone="tip" title="運用メモ">
        クライアントは一度作成したら原則削除しない運用を推奨します。複数のプロジェクトを横串で集計するキーになるため、一時利用やテスト用途にはプロジェクト単位の新規作成で対応してください。
      </InfoBox>
    </ManualPage>
  )
}
