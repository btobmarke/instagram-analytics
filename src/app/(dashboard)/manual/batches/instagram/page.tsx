import { ManualPage, Section, Table, InfoBox, Code } from '../../_components/ManualPage'

export default function InstagramBatchManual() {
  return (
    <ManualPage
      breadcrumb="マニュアル › バッチ › Instagram"
      title="Instagram バッチスケジュール"
      description="Instagram 関連バッチの実行時刻（JST）と取得内容です。Vercel Cron は UTC で登録されていますが、本ページでは JST で表記します。"
    >
      <Section title="スケジュール一覧">
        <Table
          head={['時刻(JST)', 'バッチ名', 'エンドポイント', '取得する値']}
          rows={[
            ['毎時 :00', 'insight-collector', '/api/batch/insight-collector', 'フィード・リールの投稿インサイト（リーチ／いいね／保存／コメント／インプレッション）、アカウントインサイト'],
            ['毎時 :10', 'story-insight-collector', '/api/batch/story-insight-collector', '24時間以内のストーリー投稿のインプレッション／リーチ／タップ／返信'],
            ['毎時 :45', 'kpi-calc', '/api/batch/kpi-calc', 'インサイトを元にエンゲージメント率・リーチ率等 KPI を再計算'],
            ['11:30（毎日）', 'media-collector', '/api/batch/media-collector', 'フィード・リール・ストーリーの新規投稿一覧を同期'],
            ['月曜 15:00', 'ai-analysis', '/api/batch/ai-analysis', '週次AI分析（Claude）— 投稿のパフォーマンスと改善コメントを生成'],
          ]}
        />
      </Section>

      <Section title="取得対象アカウント">
        <p>
          すべての Instagram サービスに紐付く <Code>status=active</Code> のアカウントが対象です。トークンが無効なアカウントはスキップされ、ログに記録されます。
        </p>
      </Section>

      <Section title="処理の流れ（投稿インサイト）">
        <ol className="list-decimal pl-5 space-y-1">
          <li>対象アカウントを取得。</li>
          <li>投稿一覧テーブルから「インサイト未取得」または「取得から一定時間経過」の投稿を抽出。</li>
          <li>Meta Graph API <Code>/{'{media-id}'}/insights</Code> を呼び出し、メディアタイプ（IMAGE／VIDEO／REELS／STORY）に応じたメトリクスを取得。</li>
          <li>レート制限（200req/hr）を考慮し、アカウント単位でキューイング。</li>
          <li>取得結果を保存し、失敗したものは次回リトライ対象としてログ化。</li>
        </ol>
      </Section>

      <Section title="AI分析バッチ">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>週次</strong>（月曜 15:00）：直近7日の投稿をまとめ、Claude がパフォーマンス評価と改善提案を生成。</li>
          <li><strong>月次</strong>（毎月1日）：投稿トレンドと月次サマリーを生成（現状は手動または独立スクリプトで実行）。</li>
        </ul>
      </Section>

      <InfoBox tone="warn">
        インサイトはメディアタイプ別に利用できる metric が異なります（例：リールは <Code>ig_reels_video_view_total_time</Code> 等）。未対応のメトリクスはレスポンスに含まれず、空として保存されます。
      </InfoBox>
    </ManualPage>
  )
}
