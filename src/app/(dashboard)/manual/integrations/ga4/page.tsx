import { ManualPage, Section, StepList, InfoBox, Code, Table } from '../../_components/ManualPage'

export default function Ga4IntegrationGuide() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 設定取得ガイド › GA4"
      title="Google Analytics 4 設定の取得方法"
      description="LP サービスの「連携設定」で入力する GA4 プロパティ ID とサービスアカウント JSON の取得手順です。Google Analytics と Google Cloud Console の両方の操作が必要です。"
    >
      <Section title="必要な値">
        <Table
          head={['項目', '入力欄', '取得先']}
          rows={[
            ['GA4 プロパティID', 'GA4フォーム > プロパティID', 'GA4 管理画面 ＞ プロパティ設定 に表示される 9〜10 桁の数字'],
            ['サービスアカウントJSON', 'GA4フォーム > サービスアカウントJSON', 'Google Cloud Console ＞ IAM と管理 ＞ サービスアカウント ＞ 鍵 ＞ JSON でダウンロード'],
          ]}
        />
      </Section>

      <Section title="プロパティIDの取得">
        <StepList
          steps={[
            <>Google Analytics にログインし、該当のアカウント／プロパティを選択します。</>,
            <>左下の歯車アイコン（管理）をクリック ＞ プロパティ列の <Code>プロパティの設定</Code> を開きます。</>,
            <>右上に表示される <strong>プロパティID</strong>（半角数字のみ）をコピーします。</>,
          ]}
        />
      </Section>

      <Section title="サービスアカウントの作成と JSON 発行">
        <StepList
          steps={[
            <>Google Cloud Console で GA4 を利用するプロジェクトを選択、またはプロジェクトを新規作成します。</>,
            <><Code>IAM と管理</Code> ＞ <Code>サービスアカウント</Code> ＞ <Code>サービスアカウントを作成</Code>。名前は分かりやすいものにし、ロールは未指定で作成します。</>,
            <>作成後、サービスアカウント詳細画面 ＞ <Code>鍵</Code> タブ ＞ <Code>鍵を追加</Code> ＞ <Code>新しい鍵を作成</Code> ＞ <Code>JSON</Code> を選択。ダウンロードした JSON をそのまま保管します。</>,
            <><Code>APIとサービス</Code> ＞ <Code>ライブラリ</Code> で <strong>Google Analytics Data API</strong> を有効化します。</>,
            <>GA4 プロパティの管理画面 ＞ <Code>プロパティのアクセス管理</Code> に戻り、<strong>閲覧者</strong>（Viewer）以上の権限でサービスアカウントのメールアドレスを追加します。</>,
            <>ダウンロードした JSON の中身を丸ごとコピーし、本システムの GA4 フォームの textarea に貼り付けて保存します。</>,
          ]}
        />
      </Section>

      <InfoBox tone="warn">
        JSON には秘密鍵（<Code>private_key</Code>）が含まれます。Git 管理や共有ドライブに置かず、本システム経由でのみ保管してください。ローテーションしたい場合は旧鍵を削除し、同じ手順で新しい鍵を発行して再登録します。
      </InfoBox>
    </ManualPage>
  )
}
