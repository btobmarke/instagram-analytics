import { ManualPage, Section, StepList, InfoBox, Code, Table } from '../../_components/ManualPage'

export default function InstagramIntegrationGuide() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 設定取得ガイド › Instagram"
      title="Instagram 設定の取得方法"
      description="Instagram サービスで登録する『アクセストークン』と『IGユーザーID』の取得手順を解説します。作業は Meta Business（ビジネス Suite）と Meta for Developers の 2 画面で行います。"
    >
      <Section title="必要な値">
        <Table
          head={['項目', '入力欄', '取得先']}
          rows={[
            ['IGユーザーID', 'アカウント連携モーダル > ig_user_id', 'Meta Graph API Explorer で /me/accounts?fields=instagram_business_account を叩く'],
            ['Long-Lived Access Token', 'アカウント連携モーダル > access_token', 'Meta for Developers > アプリ > Graph API Explorer（後述の手順で 60日トークンに変換）'],
            ['ユーザー名 / 表示名', 'アカウント連携モーダル', '任意の表示用ラベル'],
          ]}
        />
      </Section>

      <Section title="前提条件">
        <ul className="list-disc pl-5 space-y-1">
          <li>Instagram アカウントが <strong>ビジネス/クリエイター</strong> に切り替わっていること。</li>
          <li>Facebook ページと Instagram アカウントが紐付いていること（Meta Business Suite ＞ 設定 ＞ Instagram アカウント）。</li>
          <li>Meta for Developers でアプリ（ビジネスタイプ）を作成済みで、<Code>instagram_basic</Code>・<Code>instagram_manage_insights</Code>・<Code>pages_show_list</Code>・<Code>pages_read_engagement</Code> の権限が付与済みであること。</li>
        </ul>
      </Section>

      <Section title="取得手順（Graph API Explorer）">
        <StepList
          steps={[
            <>Meta for Developers にログインし、対象アプリの <Code>Graph API Explorer</Code> を開きます。</>,
            <>右上の <Code>User Token</Code> から Facebook ユーザーでログインし、上記の権限を全て許可します。</>,
            <>エンドポイントに <Code>me/accounts?fields=instagram_business_account{'{id,username}'}</Code> を指定して送信。レスポンスの <Code>instagram_business_account.id</Code> が <strong>IG ユーザー ID</strong> です。</>,
            <>同じ画面の短期トークンを <Code>/oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...</Code> で 60 日の Long-Lived Token に変換します。</>,
            <>変換したトークンを、サービス詳細画面「設定／連携」タブのアカウント連携モーダルに貼り付けて保存します。</>,
          ]}
        />
      </Section>

      <Section title="トークン期限管理">
        <p>
          登録後は <Code>daily_token_refresh</Code> バッチが自動延長を試みます。失敗するとアカウントが <Code>disconnected</Code> になり、設定画面に警告が表示されます。残 14 日を切るとバッジ色が黄色になるため、定期的に画面で確認してください。
        </p>
      </Section>

      <InfoBox tone="warn">
        トークンは他人に公開しないでください。漏洩した場合は Meta for Developers のアプリ設定から無効化し、本画面で再登録してください。
      </InfoBox>
    </ManualPage>
  )
}
