import { ManualPage, Section, Table, Code, InfoBox } from '../../_components/ManualPage'

export default function ExternalBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › 外部データ"
      title="外部データ（天気・祝日）バッチスケジュール"
      description="プロジェクトの分析に使用する外部参照データ（天気予報・祝日）を取得するバッチの一覧です。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '取得する値']}
          rows={[
            ['09:00 / 21:00', 'weather-sync', '/api/batch/weather-sync', '過去5日〜先7日の天気予報（気温・降水量・天気コード）と祝日を、位置情報を持つ全プロジェクトに対して一括取得'],
            ['02:00（毎日）', 'external-data', '/api/batch/external-data', '昨日分の天気・祝日を Archive API で取得（weather-sync の補完）'],
          ]}
        />
      </Section>

      <Section title="データの使われ方">
        <ul className="list-disc pl-5 space-y-1">
          <li><Code>project_external_daily</Code> に天気・祝日がキャッシュされ、各サービスの日次指標と JOIN して相関分析に使用。</li>
          <li>雨の日の来店数低下、祝日の売上ピーク、気温と投稿反応の関係などを可視化できます。</li>
        </ul>
      </Section>

      <Section title="データソース">
        <ul className="list-disc pl-5 space-y-1">
          <li>天気予報：Open-Meteo Forecast API（無料・認証不要）。</li>
          <li>過去天気：Open-Meteo Archive API。</li>
          <li>祝日：<code>date.nager.at</code> および日本特有の祝日マスター。</li>
        </ul>
      </Section>

      <InfoBox tone="info">
        位置情報（緯度・経度）が登録されていないプロジェクトはスキップされます。プロジェクト画面から設定してください。
      </InfoBox>
    </ManualPage>
  )
}
