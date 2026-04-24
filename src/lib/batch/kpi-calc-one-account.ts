import type { SupabaseClient } from '@supabase/supabase-js'

const calcVersion = '1.0'

type KpiMasterRow = Record<string, unknown> & { id: string; kpi_code: string }

/**
 * 1 IG アカウント分の KPI 計算（既存 kpi-calc ルートと同ロジック）。
 */
export async function runKpiCalcForAccount(
  admin: SupabaseClient,
  accountId: string,
  kpiMasters: KpiMasterRow[]
): Promise<number> {
  let totalProcessed = 0

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: mediaInsights } = await admin
    .from('ig_media_insight_fact')
    .select('media_id, metric_code, value, snapshot_at')
    .eq('ig_media.account_id', accountId)

  const { data: acctInsights } = await admin
    .from('ig_account_insight_fact')
    .select('metric_code, value_date, value')
    .eq('account_id', accountId)
    .gte('value_date', monthAgo)
    .lte('value_date', todayStr)

  const followerData = acctInsights?.filter(r => r.metric_code === 'follower_count') ?? []
  const latestFollowers = followerData.at(-1)?.value ?? null
  const earliestFollowers = followerData.at(0)?.value ?? null
  const followerGainMonthly =
    latestFollowers !== null && earliestFollowers !== null ? latestFollowers - earliestFollowers : null

  const { data: recentMedia } = await admin
    .from('ig_media')
    .select('id, media_product_type, posted_at')
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .gte('posted_at', weekAgo)

  for (const media of recentMedia ?? []) {
    const insights = mediaInsights?.filter(i => i.media_id === media.id) ?? []
    const getLatest = (code: string) => {
      const rows = insights
        .filter(i => i.metric_code === code)
        .sort((a, b) => new Date(b.snapshot_at).getTime() - new Date(a.snapshot_at).getTime())
      return rows[0]?.value ?? null
    }

    const reach = getLatest('reach')
    const totalInteractions = getLatest('total_interactions')
    const saved = getLatest('saved')
    const videoViews = getLatest('video_views') ?? getLatest('views')
    const impressions = getLatest('impressions') ?? getLatest('views')

    const snapshotAt = new Date().toISOString()

    if (reach && reach > 0 && totalInteractions !== null) {
      const kpi = kpiMasters.find(k => k.kpi_code === 'engagement_rate')
      if (kpi) {
        await admin.from('kpi_result').upsert({
          account_id: accountId,
          media_id: media.id,
          kpi_id: kpi.id,
          grain: 'lifetime',
          subject_type: 'media',
          period_start: media.posted_at,
          period_end: snapshotAt,
          actual_value: (totalInteractions / reach) * 100,
          source_status: 'complete',
          calculated_at: snapshotAt,
          calc_version: calcVersion,
        })
        totalProcessed++
      }
    }

    if (reach && reach > 0 && saved !== null) {
      const kpi = kpiMasters.find(k => k.kpi_code === 'save_rate')
      if (kpi) {
        await admin.from('kpi_result').upsert({
          account_id: accountId,
          media_id: media.id,
          kpi_id: kpi.id,
          grain: 'lifetime',
          subject_type: 'media',
          period_start: media.posted_at,
          period_end: snapshotAt,
          actual_value: (saved / reach) * 100,
          source_status: 'complete',
          calculated_at: snapshotAt,
          calc_version: calcVersion,
        })
        totalProcessed++
      }
    }

    if (reach && reach > 0 && impressions !== null) {
      const kpi = kpiMasters.find(k => k.kpi_code === 'impressions_to_reach')
      if (kpi) {
        await admin.from('kpi_result').upsert({
          account_id: accountId,
          media_id: media.id,
          kpi_id: kpi.id,
          grain: 'lifetime',
          subject_type: 'media',
          period_start: media.posted_at,
          period_end: snapshotAt,
          actual_value: impressions / reach,
          source_status: 'complete',
          calculated_at: snapshotAt,
          calc_version: calcVersion,
        })
      }
    }

    if (
      (media.media_product_type === 'REELS' || media.media_product_type === 'VIDEO') &&
      reach &&
      reach > 0 &&
      videoViews !== null
    ) {
      const kpi = kpiMasters.find(k => k.kpi_code === 'video_view_rate')
      if (kpi) {
        await admin.from('kpi_result').upsert({
          account_id: accountId,
          media_id: media.id,
          kpi_id: kpi.id,
          grain: 'lifetime',
          subject_type: 'media',
          period_start: media.posted_at,
          period_end: snapshotAt,
          actual_value: (videoViews / reach) * 100,
          source_status: 'complete',
          calculated_at: snapshotAt,
          calc_version: calcVersion,
        })
      }
    }
  }

  if (followerGainMonthly !== null) {
    const kpi = kpiMasters.find(k => k.kpi_code === 'follower_gain_monthly')
    if (kpi) {
      await admin.from('kpi_result').insert({
        account_id: accountId,
        kpi_id: kpi.id,
        grain: 'monthly',
        subject_type: 'account',
        period_start: monthAgo,
        period_end: todayStr,
        actual_value: followerGainMonthly,
        source_status: 'complete',
        calculated_at: new Date().toISOString(),
        calc_version: calcVersion,
      })
      totalProcessed++
    }
  }

  const weeklyPostCount = recentMedia?.length ?? 0
  const freqKpi = kpiMasters.find(k => k.kpi_code === 'post_frequency_weekly')
  if (freqKpi) {
    await admin.from('kpi_result').insert({
      account_id: accountId,
      kpi_id: freqKpi.id,
      grain: 'weekly',
      subject_type: 'account',
      period_start: weekAgo,
      period_end: todayStr,
      actual_value: weeklyPostCount,
      source_status: 'complete',
      calculated_at: new Date().toISOString(),
      calc_version: calcVersion,
    })
    totalProcessed++
  }

  return totalProcessed
}
