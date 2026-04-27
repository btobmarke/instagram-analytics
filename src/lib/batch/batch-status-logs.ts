import type { BatchJobLog } from '@/types'

/**
 * バッチ管理画面のカテゴリと同じ粒度で `batch_job_logs.job_name` を束ねる。
 * キュー分割後も各カテゴリの直近実行が画面に載るよう、API はカテゴリ別クエリに使う。
 */
export const BATCH_STATUS_JOB_GROUPS: Record<string, readonly string[]> = {
  Instagram: [
    'daily_media_collector',
    'hourly_story_media_collector',
    'hourly_story_insight_collector',
    'hourly_media_insight_collector',
    'hourly_account_insight_collector',
    'kpi_calc_batch',
    'weekly_ai_analysis',
    'instagram_velocity_retro',
    'monthly_ai_analysis',
    'daily_token_refresh',
  ],
  'LP / MA': ['lp_aggregate', 'lp_session_cleanup'],
  GA4: ['ga4_collector'],
  Clarity: ['clarity_collector'],
  GBP: ['gbp_daily'],
  'LINE OAM': ['line_oam_daily'],
  'Google 広告': ['google_ads_daily'],
  外部データ: ['weather_sync', 'external_data'],
  システム: ['project_metrics_aggregate'],
}

/** カテゴリ横断で重複しないよう id で畳み、started_at 降順に並べる */
export function mergeBatchJobLogGroups(groups: BatchJobLog[][]): BatchJobLog[] {
  const byId = new Map<string, BatchJobLog>()
  for (const rows of groups) {
    for (const row of rows) {
      if (!byId.has(row.id)) byId.set(row.id, row)
    }
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  )
}
