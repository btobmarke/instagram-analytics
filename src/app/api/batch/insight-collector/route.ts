export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { InstagramApiError, InstagramClient, isRateLimitExceeded } from '@/lib/instagram/client'
import { decrypt } from '@/lib/utils/crypto'
import { validateBatchRequest } from '@/lib/utils/batch-auth'

function logInsightError(
  scope: 'media' | 'account_insights',
  ctx: Record<string, unknown>,
  err: unknown
) {
  if (err instanceof InstagramApiError) {
    console.error(`[insight-collector] ${scope} failed`, {
      ...ctx,
      http_status: err.status,
      api_code: err.apiError?.code,
      api_type: err.apiError?.type,
      api_message: err.apiError?.message,
      fbtrace_id: err.apiError?.fbtrace_id,
      request_step: err.requestContext?.step,
      request_safe_url: err.requestContext?.safeUrl,
    })
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[insight-collector] ${scope} failed`, { ...ctx, error: message }, err)
}

// POST /api/batch/insight-collector
// 毎時実行: 全投稿のインサイト収集
export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()
  let totalProcessed = 0
  let totalFailed = 0

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'hourly_media_insight_collector',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  console.info('[insight-collector] start', { job_id: jobLog?.id ?? null })

  try {
    const { data: accounts } = await admin
      .from('ig_accounts')
      .select('id, platform_account_id, api_base_url, api_version')
      .eq('status', 'active')

    for (const account of (accounts ?? [])) {
      const { data: tokenRow } = await admin
        .from('ig_account_tokens')
        .select('access_token_enc')
        .eq('account_id', account.id)
        .eq('is_active', true)
        .single()
      if (!tokenRow) {
        console.warn('[insight-collector] skip account (no active token)', { account_id: account.id })
        continue
      }

      const accessToken = decrypt(tokenRow.access_token_enc)
      const igClient = new InstagramClient(accessToken, account.platform_account_id, {
        apiBaseUrl: account.api_base_url ?? undefined,
        apiVersion: account.api_version ?? undefined,
      })

      // 直近30日以内の投稿を対象
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: mediaList } = await admin
        .from('ig_media')
        .select('id, platform_media_id, media_product_type, media_type')
        .eq('account_id', account.id)
        .eq('is_deleted', false)
        .gte('posted_at', since)
        .order('posted_at', { ascending: false })
        .limit(50)

      for (const media of (mediaList ?? [])) {
        try {
          const mediaType = (media.media_product_type ?? media.media_type) as 'FEED' | 'REELS' | 'VIDEO' | 'STORY'
          const { data: insightData, rateUsage } = await igClient.getMediaInsights(media.platform_media_id, mediaType)

          if (isRateLimitExceeded(rateUsage, 70)) {
            console.warn('[insight-collector] rate usage high, stopping media loop for account', {
              account_id: account.id,
              rate_usage: rateUsage,
            })
            break
          }

          const insights = (insightData as {
            data: Array<{ name: string; values?: Array<{ value: number }>; value?: number; total_value?: { value?: number } }>
          })?.data ?? []
          const snapshotAt = new Date().toISOString()

          for (const insight of insights) {
            const value =
              insight.values?.[0]?.value ??
              insight.value ??
              (typeof insight.total_value?.value === 'number' ? insight.total_value.value : null)
            await admin.from('ig_media_insight_fact').upsert({
              media_id: media.id,
              metric_code: insight.name,
              period_code: 'lifetime',
              snapshot_at: snapshotAt,
              value,
            }, { onConflict: 'media_id,metric_code,period_code,snapshot_at' })
          }
          totalProcessed++
        } catch (err) {
          totalFailed++
          logInsightError('media', {
            account_id: account.id,
            platform_account_id: account.platform_account_id,
            media_id: media.id,
            platform_media_id: media.platform_media_id,
            media_product_type: media.media_product_type ?? media.media_type,
          }, err)
        }

        // レート制限対策: 100ms待機
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // アカウントインサイト収集（昨日分）
      try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const { data: acctInsight } = await igClient.getAccountInsights(yesterday, yesterday)
        type AcctRow = {
          name: string
          values?: Array<{ value: number; end_time: string }>
          total_value?: { value?: number }
        }
        const insightArr = (acctInsight as { data: AcctRow[] })?.data ?? []

        for (const metric of insightArr) {
          if (metric.values?.length) {
            for (const v of metric.values) {
              await admin.from('ig_account_insight_fact').upsert({
                account_id: account.id,
                metric_code: metric.name,
                period_code: 'day',
                value_date: v.end_time.slice(0, 10),
                value: v.value,
                fetched_at: new Date().toISOString(),
              }, { onConflict: 'account_id,metric_code,period_code,value_date' })
            }
          } else if (typeof metric.total_value?.value === 'number') {
            // v22+ metric_type=total_value 時は values ではなく total_value のみ返ることが多い
            await admin.from('ig_account_insight_fact').upsert({
              account_id: account.id,
              metric_code: metric.name,
              period_code: 'day',
              value_date: yesterday,
              value: metric.total_value.value,
              fetched_at: new Date().toISOString(),
            }, { onConflict: 'account_id,metric_code,period_code,value_date' })
          }
        }
      } catch (err) {
        logInsightError('account_insights', {
          account_id: account.id,
          platform_account_id: account.platform_account_id,
        }, err)
      }
    }

    const duration = Date.now() - startedAt.getTime()
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: totalFailed === 0 ? 'success' : 'partial',
        records_processed: totalProcessed,
        records_failed: totalFailed,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      }).eq('id', jobLog.id)
    }

    console.info('[insight-collector] done', {
      job_id: jobLog?.id ?? null,
      processed: totalProcessed,
      failed: totalFailed,
      duration_ms: duration,
      status: totalFailed === 0 ? 'success' : 'partial',
    })

    return NextResponse.json({
      success: totalFailed === 0,
      processed: totalProcessed,
      failed: totalFailed,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[insight-collector] fatal', { job_id: jobLog?.id ?? null, error: message }, err)
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
