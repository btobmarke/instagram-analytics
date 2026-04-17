import { ManualPage, Section, Code, Table, InfoBox } from '../../_components/ManualPage'

export default function ScreenSettingsManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 画面別 › 設定画面"
      title="設定画面"
      description="サイドメニュー「設定」から開く、主に Instagram アカウント単位の運用設定を行う画面です。URL パラメータ ?account=xxx でアカウントを切り替えます。"
    >
      <Section title="タブ構成">
        <Table
          head={['タブ', '内容']}
          rows={[
            ['アカウント設定', '目標フォロワー数・目標エンゲージメント率など、代表的な KPI を簡易設定します。入力値は analytics 画面の目標ラインに反映されます。'],
            ['KPI設定', 'KPIマスターから必要な KPI を選択し、月次の目標値・警告閾値・危険閾値を詳細に登録します。有効化したKPIのみ分析画面に表示されます。'],
            ['プロンプト設定', '投稿単体分析／投稿比較／週次／月次など、Claude に送るプロンプト文面を編集します。最新のInstagramアルゴリズム情報は「最新情報を取得」ボタンから自動調査できます。'],
            ['戦略設定', 'アカウントの運用方針・ターゲット・コンセプトをテキストで登録。AI分析時に参照されます。'],
          ]}
        />
      </Section>

      <Section title="各タブの使い方">
        <p>
          <strong>アカウント設定</strong>：6項目の目標値を入力し <Code>保存</Code>。対象アカウントは URL の <Code>?account=</Code> で指定します。
        </p>
        <p>
          <strong>KPI設定</strong>：カテゴリ（エンゲージメント／リーチ／成長／コンテンツ／コンバージョン）別に KPI が並びます。有効チェックを入れたものだけ目標値入力が有効になります。
        </p>
        <p>
          <strong>プロンプト設定</strong>：各分析種別ごとに textarea で編集できます。<Code>最新情報を取得</Code> を押すと Claude によるアルゴリズム調査結果が上部に表示され、プロンプトへ引用できます。
        </p>
        <p>
          <strong>戦略設定</strong>：ターゲット層・投稿スタイルなどを自然文で記述します。AI分析の出力品質を大きく左右するため、運用開始時に丁寧に記入することを推奨します。
        </p>
      </Section>

      <Section title="関連画面">
        <ul className="list-disc pl-5 space-y-1">
          <li><Code>/settings/line-oam</Code>：LINE OAM データ取得に使用する URL テンプレートを管理します。</li>
        </ul>
      </Section>

      <InfoBox tone="tip">
        設定変更は即時に保存されます。「保存しました」のトーストが画面上部に表示されることを確認してください。
      </InfoBox>
    </ManualPage>
  )
}
