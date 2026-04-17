import { ManualPage, Section, StepList, InfoBox, Code, Table } from '../../_components/ManualPage'

export default function ClarityIntegrationGuide() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 設定取得ガイド › Clarity"
      title="Microsoft Clarity 設定の取得方法"
      description="LP サービスの「連携設定」で入力する Clarity プロジェクト ID と Export API キーの取得手順です。"
    >
      <Section title="必要な値">
        <Table
          head={['項目', '入力欄', '取得先']}
          rows={[
            ['プロジェクトID', 'Clarityフォーム > プロジェクトID', 'Clarity ダッシュボード ＞ Settings ＞ Setup ＞ Project ID'],
            ['API キー', 'Clarityフォーム > API キー', 'Clarity ダッシュボード ＞ Settings ＞ Data Export（または API Access）で生成'],
          ]}
        />
      </Section>

      <Section title="プロジェクトIDの取得">
        <StepList
          steps={[
            <>Clarity（<Code>clarity.microsoft.com</Code>）にログインし、対象プロジェクトを開きます。</>,
            <>左下の <Code>Settings</Code> ＞ <Code>Setup</Code> の上部に表示される 10 桁程度の英数字 ID を控えます。</>,
          ]}
        />
      </Section>

      <Section title="API キーの生成">
        <StepList
          steps={[
            <>同じく <Code>Settings</Code> から <Code>Data Export</Code>（プランにより <Code>API Access</Code>）を選択します。</>,
            <><Code>Generate new API key</Code> をクリックしてキーを生成します。表示されたキーは <strong>一度しか表示されない</strong> ためこの時点で控えてください。</>,
            <>本システムの Clarity フォームにプロジェクト ID と生成した API キーを入力し、保存します。</>,
          ]}
        />
      </Section>

      <InfoBox tone="info">
        Clarity Export API は <strong>直近 3 日分までしか取得できない</strong> 制約があります。バッチは毎日自動で走りますが、長期停止していた場合は差分が欠落する点に注意してください。
      </InfoBox>
    </ManualPage>
  )
}
