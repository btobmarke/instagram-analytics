import { ManualPage, Section, StepList, InfoBox, Code, Table } from '../../_components/ManualPage'

export default function GoogleAdsIntegrationGuide() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 設定取得ガイド › Google 広告"
      title="Google 広告 設定の取得方法"
      description="Google 広告サービスで入力する顧客 ID と、Google Ads API 連携のための OAuth 認可および開発者トークンの取得手順を解説します。"
    >
      <Section title="必要な値">
        <Table
          head={['項目', '入力欄', '取得先']}
          rows={[
            ['顧客ID（Customer ID）', 'Google広告サービス > 設定タブ', 'Google 広告管理画面 右上に表示される 10 桁の数字（ハイフンなし）'],
            ['開発者トークン', '（運営側） 環境変数 GOOGLE_ADS_DEVELOPER_TOKEN', 'Google 広告 ＞ ツール ＞ API センター から申請・発行'],
            ['OAuth リフレッシュトークン', '（運営側） 環境変数', 'Google Cloud Console で OAuth クライアントを作成し、オフラインアクセスで取得'],
            ['通貨コード／タイムゾーン', '同設定タブ（自動取得）', '顧客 ID 登録後、API から自動反映'],
          ]}
        />
      </Section>

      <Section title="顧客 ID の確認">
        <StepList
          steps={[
            <>Google 広告管理画面（<Code>ads.google.com</Code>）にログインします。</>,
            <>右上のアカウントアイコン付近に <strong>xxx-xxx-xxxx</strong> 形式の顧客 ID が表示されます。</>,
            <>ハイフンを除いた 10 桁を、サービス詳細の <Code>設定</Code> タブに入力して保存します。</>,
          ]}
        />
      </Section>

      <Section title="開発者トークンと OAuth 認可（運営側の初期設定）">
        <StepList
          steps={[
            <>Google 広告 ＞ ツールと設定 ＞ <Code>API センター</Code> を開き、開発者トークンを申請します。本番利用には承認が必要です（Test Access でも動作確認は可能）。</>,
            <>Google Cloud Console で <Code>Google Ads API</Code> を有効化し、<Code>OAuth 2.0 クライアント ID</Code>（デスクトップアプリ or ウェブ）を作成します。</>,
            <><Code>oauth2l</Code> や <Code>google-auth-oauthlib</Code> 等で <strong>オフラインアクセス</strong>（<Code>access_type=offline</Code>、スコープ <Code>https://www.googleapis.com/auth/adwords</Code>）のリフレッシュトークンを取得します。</>,
            <>取得した開発者トークン・クライアント ID・シークレット・リフレッシュトークンを Vercel の環境変数に登録します。</>,
          ]}
        />
        <InfoBox tone="warn">
          開発者トークンとリフレッシュトークンはシステム全体で共有する運営側のシークレットです。クライアント画面からは直接入力できず、環境変数で管理されます。クライアント追加ごとに入力し直す必要はありません。
        </InfoBox>
      </Section>

      <Section title="マネージャーアカウント（MCC）経由の場合">
        <p>
          MCC 配下のクライアント顧客 ID を指定する場合、MCC 側でリンクが承認されている必要があります。承認前の顧客 ID を登録するとバッチが <Code>USER_PERMISSION_DENIED</Code> で失敗します。
        </p>
      </Section>

      <Section title="キーワード収集の設定">
        <p>
          <Code>設定</Code> タブの <Code>collect_keywords</Code> をオンにすると、日次でキーワード単位のデータも収集します。件数が多く API 呼び出しが増えるため、必要な場合のみオンにしてください。
        </p>
      </Section>
    </ManualPage>
  )
}
