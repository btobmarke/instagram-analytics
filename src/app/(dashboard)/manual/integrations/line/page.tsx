import { ManualPage, Section, StepList, InfoBox, Code, Table } from '../../_components/ManualPage'

export default function LineIntegrationGuide() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 設定取得ガイド › LINE OAM"
      title="LINE OAM 設定の取得方法"
      description="LINE サービスで入力する Bot ID／リワードカード ID の取得手順と、URL テンプレートの仕組みを解説します。"
    >
      <Section title="必要な値">
        <Table
          head={['項目', '入力欄', '取得先']}
          rows={[
            ['Bot ID', 'LINEサービス > Bot ID', 'LINE Official Account Manager の URL またはアカウント設定 ＞ 基本情報'],
            ['リワードカードID', 'LINEサービス > リワードカード一覧', 'OAM ＞ ホーム ＞ リワードカード ＞ 該当カードの URL から抽出'],
            ['URLテンプレート', '（管理者のみ）設定 ＞ LINE OAM', 'CSV ダウンロード URL を OAM のネットワークログから控えて登録'],
          ]}
        />
      </Section>

      <Section title="Bot ID の取得">
        <StepList
          steps={[
            <>LINE Official Account Manager（<Code>manager.line.biz</Code>）にログインします。</>,
            <>対象アカウントを選択した状態でブラウザの URL を確認します。<Code>/account/{'{Bot_ID}'}/</Code> の部分が Bot ID です（英数字 10 桁前後）。</>,
            <>サービス登録フォームの <Code>Bot ID</Code> に貼り付けます。</>,
          ]}
        />
      </Section>

      <Section title="リワードカードIDの取得">
        <StepList
          steps={[
            <>OAM ＞ 左メニュー <Code>ホーム</Code> ＞ <Code>リワードカード</Code> を開きます。</>,
            <>対象カードをクリックし、開かれた URL の <Code>rewardcards/{'{rewardcard_id}'}</Code> 部分を控えます。</>,
            <>サービス詳細のリワードカード登録欄から、ID と開始日を入力して保存します。</>,
          ]}
        />
      </Section>

      <Section title="URL テンプレートの仕組み（管理者向け）">
        <p>
          本システムは OAM の画面構成に依存した URL で CSV を取得しています。OAM がレイアウトを変更した場合、設定 ＞ LINE OAM 画面で URL テンプレートを更新することで全プロジェクトに一括反映されます。テンプレートには以下のプレースホルダが利用できます。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><Code>{`{base_url}`}</Code>：OAM API のベース URL</li>
          <li><Code>{`{bot_id}`}</Code>：対象アカウントの Bot ID</li>
          <li><Code>{`{rewardcard_id}`}</Code>：リワードカード ID（rewardcard_txns のみ）</li>
          <li>対象 CSV：base_url / contacts / friends_attr / shopcard_status / shopcard_point / rewardcard_txns</li>
        </ul>
      </Section>

      <InfoBox tone="warn">
        OAM の CSV 取得には管理者権限の Cookie が必要です。バッチ側の認証情報は環境変数で管理されており、OAM 側でパスワード変更した場合などは再設定が必要です。
      </InfoBox>
    </ManualPage>
  )
}
