import { ManualPage, Section, Table, InfoBox } from '../../_components/ManualPage'

export default function LineBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › LINE OAM"
      title="LINE OAM バッチスケジュール"
      description="LINE 公式アカウントマネージャー連携バッチの実行時刻（JST）と取得内容です。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '取得する値']}
          rows={[
            ['13:30（毎日）', 'line-oam-daily', '/api/batch/line-oam-daily', 'フレンド数・ブロック数、フレンド属性（性別・年代・地域）、ショップカード発行ステータス、ショップカード・ポイント分布、リワードカード取引履歴（カード ID ごと）'],
          ]}
        />
      </Section>

      <Section title="取得対象">
        <p>
          LINE OAM サービスに Bot ID が登録されていることが必須。リワードカード取引履歴は、リワードカード一覧に登録された ID ごとにダウンロードします。
        </p>
      </Section>

      <Section title="処理の流れ">
        <ol className="list-decimal pl-5 space-y-1">
          <li>設定 ＞ LINE OAM で管理されている URL テンプレートを取得。</li>
          <li>テンプレート内の <code>{'{base_url}'}</code>・<code>{'{bot_id}'}</code>・<code>{'{rewardcard_id}'}</code> を対象サービスの値で展開。</li>
          <li>環境変数のセッション Cookie を使って OAM から CSV をダウンロード。</li>
          <li>CSV を解析し、<code>line_*</code> 系テーブルにアップサート。</li>
        </ol>
      </Section>

      <InfoBox tone="warn">
        Cookie の期限切れや OAM の UI 変更によりダウンロード先 URL が変わることがあります。失敗が継続する場合は、設定 ＞ LINE OAM で URL テンプレートの見直しと、環境変数の Cookie 更新をご確認ください。
      </InfoBox>
    </ManualPage>
  )
}
