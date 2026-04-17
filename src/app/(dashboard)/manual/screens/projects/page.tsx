import { ManualPage, Section, StepList, InfoBox, Code } from '../../_components/ManualPage'

export default function ScreenProjectsManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › 画面別 › プロジェクト画面"
      title="プロジェクト画面"
      description="クライアント配下に並ぶ、案件単位の管理画面です。プロジェクト直下には Instagram・LP・LINE・GBP・Google広告・売上分析・サマリーといった「サービス」を登録して運用します。"
    >
      <Section title="画面でできること">
        <ul className="list-disc pl-5 space-y-1">
          <li>プロジェクト情報の表示と編集</li>
          <li>プロジェクトの位置情報（緯度・経度）の設定（天気／祝日データに使用）</li>
          <li>配下のサービスの一覧表示と、新規サービス登録</li>
          <li>プロジェクトを横断した統合サマリーの閲覧</li>
        </ul>
      </Section>

      <Section title="サービスの登録手順">
        <StepList
          steps={[
            <>プロジェクト画面右上の <Code>サービス追加</Code> をクリックします。</>,
            <>ダイアログでサービス種別（Instagram / LP / LINE / Google広告 / GBP / 売上 / サマリー 等）を選択します。</>,
            <>サービス名と、種別ごとの初期設定値を入力して <Code>登録</Code> します。</>,
            <>一覧に戻り、登録したサービス行をクリックするとサービス詳細画面（分析画面）に遷移します。</>,
          ]}
        />
      </Section>

      <Section title="位置情報設定について">
        <p>
          プロジェクトに緯度・経度を登録しておくと、バッチ <Code>weather_sync</Code> が過去5日〜先7日の天気予報と祝日を取得し、投稿成果や来店数との相関分析に利用できます。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>主要都市（東京・大阪・名古屋・福岡・札幌・仙台）はプリセットから選択可能です。</li>
          <li>位置情報を削除した場合、天気データの取得は停止します。</li>
        </ul>
      </Section>

      <Section title="統合サマリーへの導線">
        <p>
          プロジェクト画面の <Code>統合サマリー</Code> ボタンから、配下サービスの KPI を一枚で俯瞰できる画面に遷移します。サービスごとの期間比較やクライアント報告書の素材として利用できます。
        </p>
      </Section>

      <InfoBox tone="warn" title="サービス削除時の注意">
        サービスを削除すると、そのサービスに紐づくインサイト・イベント・集計キャッシュも削除対象となります。復元はできないため、慎重に操作してください。
      </InfoBox>
    </ManualPage>
  )
}
