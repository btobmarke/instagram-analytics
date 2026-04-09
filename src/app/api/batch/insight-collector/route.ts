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
  let acctInsightTotal = 0

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'hourly_media_insight_collector',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  console.info('[insight-collector] start', { job_id: jobLog?.id ?? null })

  try {
    const { data: accounts, error: accountsError } = await admin
      .from('ig_accounts')
      .select('id, platform_account_id, api_base_url, api_version, service_id')
      .eq('status', 'active')
      .not('service_id', 'is', null)

    console.info('[insight-collector] accounts found', {
      count: accounts?.length ?? 0,
      error: accountsError?.message ?? null,
    })

    for (const account of (accounts ?? [])) {
      console.info('[insight-collector] processing account', {
        account_id: account.id,
        platform_account_id: account.platform_account_id,
      })

      // service_id → project_id → client_id → client_ig_tokens
      const { data: svcRow } = await admin
        .from('services')
        .select('project_id, projects!inner(client_id)')
        .eq('id', account.service_id!)
        .single()

      const clientId = (svcRow?.projects as { client_id: string } | null)?.client_id

      if (!clientId) {
        console.warn('[insight-collector] skip account (cannot resolve client)', {
          account_id: account.id,
          service_id: account.service_id,
        })
        continue
      }

      const { data: tokenRow, error: tokenError } = await admin
        .from('client_ig_tokens')
        .select('access_token_enc')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .single()
      if (!tokenRow) {
        console.warn('[insight-collector] skip account (no active token for client)', {
          account_id: account.id,
          client_id: clientId,
          token_error: tokenError?.message ?? null,
        })
        continue
      }
      console.info('[insight-collector] token found', { account_id: account.id, client_id: clientId })

      const accessToken = decrypt(tokenRow.access_token_enc)
      const igClient = new InstagramClient(accessToken, account.platform_account_id, {
        apiBaseUrl: account.api_base_url ?? undefined,
        apiVersion: account.api_version ?? undefined,
      })

      // 直近30日以内の投稿を対象
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: mediaList, error: mediaListError } = await admin
        .from('ig_media')
        .select('id, platform_media_id, media_product_type, media_type')
        .eq('account_id', account.id)
        .eq('is_deleted', false)
        .gte('posted_at', since)
        .order('posted_at', { ascending: false })
        .limit(50)

      console.info('[insight-collector] media to process', {
        account_id: account.id,
        media_count: mediaList?.length ?? 0,
        error: mediaListError?.message ?? null,
      })

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

      // アカウントインサイト収集（直近7日分: データ遅延に備えて広めに取得）
      try {
        const until   = new Date(Date.now() - 1  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const since   = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        console.info('[insight-collector] fetching account insights', {
          account_id: account.id,
          since,
          until,
        })

        type AcctRow = {
          name: string
          values?: Array<{ value: number; end_time: string }>
          total_value?: { value?: number }
        }
        let acctUpsertCount = 0

        // --- (A) reach: period=day で日次 values 配列を取得 ---
        try {
          const { data: tsData } = await igClient.getAccountInsightsTimeSeries(since, until)
          const tsArr = (tsData as { data: AcctRow[] })?.data ?? []
          console.info('[insight-collector] time-series metrics', {
            account_id: account.id,
            count: tsArr.length,
            metrics: tsArr.map(m => m.name),
          })
          for (const metric of tsArr) {
            if (!metric.values?.length) continue
            for (const v of metric.values) {
              const endDate = new Date(v.end_time)
              endDate.setDate(endDate.getDate() - 1)
              const valueDate = endDate.toISOString().slice(0, 10)
              const { error: upsertErr } = await admin.from('ig_account_insight_fact').upsert({
                account_id: account.id,
                metric_code: metric.name,
                dimension_code: '',
                dimension_value: '',
                period_code: 'day',
                value_date: valueDate,
                value: v.value,
                fetched_at: new Date().toISOString(),
              }, { onConflict: 'account_id,metric_code,period_code,value_date,dimension_code,dimension_value' })
              if (upsertErr) {
                console.error('[insight-collector] ts upsert failed', {
                  metric: metric.name, valueDate, error: upsertErr.message,
                })
              } else {
                acctUpsertCount++
              }
            }
          }
        } catch (tsErr) {
          console.warn('[insight-collector] time-series call failed (non-fatal)', tsErr)
        }

        // --- (B) total_value メトリクス: 1日ずつ取得 ---
        // metric_type=total_value + period=day は複数日レンジだと data:[] になるため1日ずつ
        const sinceDate = new Date(since + 'T00:00:00Z')
        const untilDate = new Date(until + 'T00:00:00Z')
        for (let d = new Date(sinceDate); d <= untilDate; d.setDate(d.getDate() + 1)) {
          const daySince = d.toISOString().slice(0, 10)
          const nextDay = new Date(d)
          nextDay.setDate(nextDay.getDate() + 1)
          const dayUntil = nextDay.toISOString().slice(0, 10)
          try {
            const { data: tvData } = await igClient.getAccountInsightsTotalValue(daySince, dayUntil)
            const tvArr = (tvData as { data: AcctRow[] })?.data ?? []
            console.info('[insight-collector] total_value metrics', {
              account_id: account.id,
              date: daySince,
              count: tvArr.length,
              metrics: tvArr.map(m => ({ name: m.name, val: m.total_value?.value })),
            })
            for (const metric of tvArr) {
              const val = metric.total_value?.value
              if (typeof val !== 'number') continue
              const { error: upsertErr } = await admin.from('ig_account_insight_fact').upsert({
                account_id: account.id,
                metric_code: metric.name,
                dimension_code: '',
                dimension_value: '',
                period_code: 'day',
                value_date: daySince,
                value: val,
                fetched_at: new Date().toISOString(),
              }, { onConflict: 'account_id,metric_code,period_code,value_date,dimension_code,dimension_value' })
              if (upsertErr) {
                console.error('[insight-collector] tv upsert failed', {
                  metric: metric.name, date: daySince, error: upsertErr.message,
                })
              } else {
                acctUpsertCount++
              }
            }
          } catch (tvErr) {
            console.warn('[insight-collector] total_value call failed for date', { date: daySince, error: tvErr })
          }
          // レート制限対策
          await new Promise(resolve => setTimeout(resolve, 200))
        }

        acctInsightTotal += acctUpsertCount
        console.info('[insight-collector] account insights upserted', {
          account_id: account.id,
          upserted: acctUpsertCount,
        })
      } catch (err) {
        totalFailed++
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
      media_insights_processed: totalProcessed,
      account_insights_upserted: acctInsightTotal,
      failed: totalFailed,
      duration_ms: duration,
      status: totalFailed === 0 ? 'success' : 'partial',
    })

    return NextResponse.json({
      success: totalFailed === 0,
      media_insights_processed: totalProcessed,
      account_insights_upserted: acctInsightTotal,
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

// Vercel Cron は GET で呼び出す
export async function GET(request: Request) {
  return POST(request)
}
