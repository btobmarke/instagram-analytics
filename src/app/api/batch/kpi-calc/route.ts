export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

// POST /api/batch/kpi-calc — KPI計算バッチ
export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const accountIdFilter = typeof body.account_id === 'string' ? body.account_id : undefined

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()
  const calcVersion = '1.0'
  let totalProcessed = 0

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'kpi_calc_batch',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  try {
    let acctQ = admin.from('ig_accounts').select('id').eq('status', 'active')
    if (accountIdFilter) acctQ = acctQ.eq('id', accountIdFilter)
    const { data: accounts } = await acctQ
    const { data: kpiMasters } = await admin.from('kpi_master').select('*').eq('is_active', true)

    for (const account of (accounts ?? [])) {
      // 期間設定
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      // 最新インサイト取得
      const { data: mediaInsights } = await admin
        .from('ig_media_insight_fact')
        .select('media_id, metric_code, value, snapshot_at')
        .eq('ig_media.account_id', account.id)

      // アカウントインサイト（当月）
      const { data: acctInsights } = await admin
        .from('ig_account_insight_fact')
        .select('metric_code, value_date, value')
        .eq('account_id', account.id)
        .gte('value_date', monthAgo)
        .lte('value_date', todayStr)

      // フォロワー増減計算
      const followerData = acctInsights?.filter(r => r.metric_code === 'follower_count') ?? []
      const latestFollowers = followerData.at(-1)?.value ?? null
      const earliestFollowers = followerData.at(0)?.value ?? null
      const followerGainMonthly = latestFollowers !== null && earliestFollowers !== null
        ? latestFollowers - earliestFollowers : null

      // 投稿ごとのエンゲージメント率計算
      const { data: recentMedia } = await admin
        .from('ig_media')
        .select('id, media_product_type, posted_at')
        .eq('account_id', account.id)
        .eq('is_deleted', false)
        .gte('posted_at', weekAgo)

      for (const media of (recentMedia ?? [])) {
        const insights = mediaInsights?.filter(i => i.media_id === media.id) ?? []
        const getLatest = (code: string) => {
          const rows = insights.filter(i => i.metric_code === code).sort((a, b) =>
            new Date(b.snapshot_at).getTime() - new Date(a.snapshot_at).getTime()
          )
          return rows[0]?.value ?? null
        }

        const reach = getLatest('reach')
        const totalInteractions = getLatest('total_interactions')
        const likes = getLatest('likes')
        const comments = getLatest('comments')
        const saved = getLatest('saved')
        const shares = getLatest('shares')
        // v22+ メディアインサイトは impressions→views、video_views 非推奨
        const videoViews = getLatest('video_views') ?? getLatest('views')
        const impressions = getLatest('impressions') ?? getLatest('views')

        const snapshotAt = new Date().toISOString()

        // エンゲージメント率
        if (reach && reach > 0 && totalInteractions !== null) {
          const kpi = kpiMasters?.find(k => k.kpi_code === 'engagement_rate')
          if (kpi) {
            await admin.from('kpi_result').upsert({
              account_id: account.id,
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

        // 保存率
        if (reach && reach > 0 && saved !== null) {
          const kpi = kpiMasters?.find(k => k.kpi_code === 'save_rate')
          if (kpi) {
            await admin.from('kpi_result').upsert({
              account_id: account.id,
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

        // インプレッション/リーチ比
        if (reach && reach > 0 && impressions !== null) {
          const kpi = kpiMasters?.find(k => k.kpi_code === 'impressions_to_reach')
          if (kpi) {
            await admin.from('kpi_result').upsert({
              account_id: account.id,
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

        // 動画視聴率
        if ((media.media_product_type === 'REELS' || media.media_product_type === 'VIDEO') && reach && reach > 0 && videoViews !== null) {
          const kpi = kpiMasters?.find(k => k.kpi_code === 'video_view_rate')
          if (kpi) {
            await admin.from('kpi_result').upsert({
              account_id: account.id,
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

      // アカウントレベルKPI: フォロワー月次増減
      if (followerGainMonthly !== null) {
        const kpi = kpiMasters?.find(k => k.kpi_code === 'follower_gain_monthly')
        if (kpi) {
          await admin.from('kpi_result').insert({
            account_id: account.id,
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

      // 週間投稿頻度
      const weeklyPostCount = recentMedia?.length ?? 0
      const freqKpi = kpiMasters?.find(k => k.kpi_code === 'post_frequency_weekly')
      if (freqKpi) {
        await admin.from('kpi_result').insert({
          account_id: account.id,
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
    }

    const duration = Date.now() - startedAt.getTime()
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'success',
        records_processed: totalProcessed,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      }).eq('id', jobLog.id)
    }

    await notifyBatchSuccess({
      jobName: 'kpi_calc_batch',
      processed: totalProcessed,
      executedAt: startedAt,
    })

    return NextResponse.json({ success: true, processed: totalProcessed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'kpi_calc_batch',
      processed: 0,
      errorCount: 1,
      errors: [{ error: message }],
      executedAt: startedAt,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel Cron は GET で呼び出す
export async function GET(request: Request) {
  return POST(request)
}
