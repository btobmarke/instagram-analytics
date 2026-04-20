import { ManualPage, Section, Table, InfoBox, Code } from '../../_components/ManualPage'

export default function LineServiceManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › サービス詳細 › LINE OAM"
      title="LINE OAM サービス"
      description="LINE 公式アカウントマネージャー（OAM）の CSV エクスポートを取り込み、フレンド数・属性・ショップカード・リワードカード取引履歴を分析するサービスです。"
    >
      <Section title="画面構成（タブ）">
        <Table
          head={['タブ', 'パス', '機能']}
          rows={[
            ['設定（統合）', '/line', 'Messaging API 認証・Webhook、Bot ID、リワードカード等。'],
            ['ダッシュボード', '/line/dashboard', 'OAM 分析と MA 指標を 1 画面に統合。'],
          ]}
        />
      </Section>

      <Section title="取得しているデータ">
        <Table
          head={['CSV種別', '内容']}
          rows={[
            ['contacts', '日次フレンド数・ブロック数の推移。'],
            ['friends_attr', 'フレンドの性別・年代・地域の属性分布。'],
            ['shopcard_status', 'ショップカード発行状況のステータス別集計。'],
            ['shopcard_point', 'ポイント分布（保有ポイントごとのユーザー数）。'],
            ['rewardcard_txns', 'リワードカード単位での取引履歴（獲得・利用）。'],
          ]}
        />
      </Section>

      <Section title="サービスに紐づく設定項目">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Bot ID</strong>：LINE 公式アカウントの Bot 識別子。URL テンプレートの <Code>{`{bot_id}`}</Code> に埋め込まれます。</li>
          <li><strong>リワードカード登録</strong>：リワードカード ID と開始日を登録しておくと、<Code>{`{rewardcard_id}`}</Code> が展開され取引履歴 CSV が自動取得されます。</li>
        </ul>
      </Section>

      <Section title="URL テンプレート">
        <p>
          データソースとなる CSV の URL パターンは「設定 ＞ LINE OAM」画面で一括管理しています。OAM の UI 変更時はここを更新することで全プロジェクトに反映されます。
        </p>
      </Section>

      <InfoBox tone="warn">
        OAM CSV へのアクセスには Cookie ベースのセッションが必要です。収集バッチ用の認証情報は環境変数で管理されており、期限切れ時はバッチが失敗します。失敗を検知した場合は再認証してください。
      </InfoBox>
    </ManualPage>
  )
}
