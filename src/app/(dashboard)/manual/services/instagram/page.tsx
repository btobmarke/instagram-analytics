import { ManualPage, Section, Table, InfoBox, Code } from '../../_components/ManualPage'

export default function InstagramServiceManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › サービス詳細 › Instagram"
      title="Instagram サービス"
      description="Instagramビジネスアカウントを登録し、アカウント分析／投稿一覧／投稿インサイト／AI 分析を行えるサービス種別です。"
    >
      <Section title="画面構成（タブ）">
        <Table
          head={['タブ', 'パス', '機能']}
          rows={[
            ['トップ', '/projects/:p/services/:s/instagram', 'アカウント基本情報、トークン有効期限、最終同期日時の確認と手動同期。'],
            ['アナリティクス', '/instagram/analytics', 'フォロワー推移・リーチ・PV・インタラクションの時系列グラフと KPI 進捗。'],
            ['投稿一覧', '/instagram/posts', 'フィード／リール／ストーリーを絞り込みながら閲覧。投稿単位のインサイトへ遷移。'],
            ['AI分析', '/instagram/ai', 'Claude による週次・月次の傾向分析と改善提案コメントを表示。'],
            ['設定／連携', '/integrations', 'Meta の Long-Lived Access Token や IGユーザーIDの登録。'],
          ]}
        />
      </Section>

      <Section title="主要機能">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>アカウントインサイト</strong>：フォロワー数・リーチ・PV・プロフィール閲覧数を日次で保存。</li>
          <li><strong>投稿インサイト</strong>：フィード／リール／ストーリー別にリーチ・いいね・保存・コメント・インプレッション（View）を収集。</li>
          <li><strong>ストーリー</strong>：24時間で消える特性を踏まえ、2 時間おきに取得。</li>
          <li><strong>KPI再計算</strong>：エンゲージメント率・リーチ率などの派生指標を毎時再計算。</li>
          <li><strong>AI分析</strong>：投稿単体／比較／週次／月次の 4 種類のプロンプトで Claude を呼び出し、コメントを自動生成。</li>
        </ul>
      </Section>

      <Section title="トークン管理">
        <p>
          Instagram Graph API の Long-Lived Token は有効期限 60 日で、<Code>daily_token_refresh</Code> バッチが自動更新します。残り14日を切ると画面上に警告バッジが表示されます。期限切れの場合は「設定／連携」タブから再登録が必要です。
        </p>
      </Section>

      <InfoBox tone="warn">
        Instagramビジネスアカウントは、あらかじめ Facebook ページに紐付け、Meta Business Suite でビジネスアカウントに切り替えておく必要があります。個人アカウントでは Graph API が利用できません。
      </InfoBox>
    </ManualPage>
  )
}
