export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { InstagramApiError, InstagramClient, isRateLimitExceeded } from '@/lib/instagram/client'
import { decrypt } from '@/lib/utils/crypto'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

type MediaInsightRow = {
  id: string
  platform_media_id: string
  media_product_type: string | null
  media_type: string
}

/**
 * メディアインサイト収集の対象キュー。
 * 以前は「30日以内・新しい順50件」のみで、投稿が多いアカウントでは「昨日の投稿」が50件圏外に落ちて
 * 一切インサイトが取れないバグがあった。
 * 直近7日は最大120件を必ず対象にし、7〜30日前は最大80件を追加（重複除く・合計上限に近いがレート内で処理）。
 */
async function loadMediaQueueForInsightCollection(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  accountId: string
): Promise<MediaInsightRow[]> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: recent, error: errRecent } = await admin
    .from('ig_media')
    .select('id, platform_media_id, media_product_type, media_type')
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .gte('posted_at', since7d)
    .order('posted_at', { ascending: false })
    .limit(120)

  if (errRecent) {
    console.warn('[insight-collector] recent media query failed', {
      account_id: accountId,
      error: errRecent.message,
    })
  }

  const { data: older, error: errOlder } = await admin
    .from('ig_media')
    .select('id, platform_media_id, media_product_type, media_type')
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .gte('posted_at', since30d)
    .lt('posted_at', since7d)
    .order('posted_at', { ascending: false })
    .limit(80)

  if (errOlder) {
    console.warn('[insight-collector] older media query failed', {
      account_id: accountId,
      error: errOlder.message,
    })
  }

  const seen = new Set<string>()
  const out: MediaInsightRow[] = []
  for (const m of recent ?? []) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m as MediaInsightRow)
  }
  for (const m of older ?? []) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m as MediaInsightRow)
  }
  return out
}

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

      const mediaList = await loadMediaQueueForInsightCollection(admin, account.id)

      console.info('[insight-collector] media to process', {
        account_id: account.id,
        media_count: mediaList.length,
      })

      for (const media of mediaList) {
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

          // ストーリー: 公式推奨の navigation（breakdown）も保存（既存 taps_* と併存）
          if (mediaType === 'STORY') {
            try {
              const { data: navData, rateUsage: navRate } = await igClient.getMediaStoryNavigationInsights(
                media.platform_media_id,
              )
              if (isRateLimitExceeded(navRate, 70)) {
                console.warn('[insight-collector] rate usage high after story navigation fetch', {
                  account_id: account.id,
                  rate_usage: navRate,
                })
              } else {
                type NavInsight = {
                  name: string
                  total_value?: {
                    breakdowns?: Array<{
                      results?: Array<{ dimension_values?: string[]; value?: number }>
                    }>
                  }
                }
                const navArr = (navData as { data: NavInsight[] })?.data ?? []
                const nav = navArr.find(n => n.name === 'navigation')
                const results = nav?.total_value?.breakdowns?.flatMap(b => b.results ?? []) ?? []
                for (const r of results) {
                  const action = (r.dimension_values?.[0] ?? '').toLowerCase()
                  if (!action) continue
                  await admin.from('ig_media_insight_fact').upsert({
                    media_id: media.id,
                    metric_code: `navigation_${action}`,
                    period_code: 'lifetime',
                    snapshot_at: snapshotAt,
                    value: typeof r.value === 'number' ? r.value : null,
                  }, { onConflict: 'media_id,metric_code,period_code,snapshot_at' })
                }
              }
            } catch (navErr) {
              console.warn('[insight-collector] story navigation insights failed (non-fatal)', {
                account_id: account.id,
                media_id: media.id,
                platform_media_id: media.platform_media_id,
                error: navErr instanceof Error ? navErr.message : String(navErr),
              })
            }
          }

          // 投稿→プロフィール行動（profile_activity + action_type breakdown）
          if (mediaType === 'FEED' || mediaType === 'REELS' || mediaType === 'STORY' || mediaType === 'VIDEO') {
            try {
              const { data: paData, rateUsage: paRate } = await igClient.getMediaProfileActivityInsights(
                media.platform_media_id,
              )
              if (isRateLimitExceeded(paRate, 70)) {
                console.warn('[insight-collector] rate usage high after profile_activity fetch', {
                  account_id: account.id,
                  rate_usage: paRate,
                })
              } else {
                type PaInsight = {
                  name: string
                  total_value?: {
                    breakdowns?: Array<{
                      results?: Array<{ dimension_values?: string[]; value?: number }>
                    }>
                  }
                }
                const paArr = (paData as { data: PaInsight[] })?.data ?? []
                const pa = paArr.find(x => x.name === 'profile_activity')
                const results = pa?.total_value?.breakdowns?.flatMap(b => b.results ?? []) ?? []
                for (const r of results) {
                  const action = (r.dimension_values?.[0] ?? '').toLowerCase()
                  if (!action) continue
                  await admin.from('ig_media_insight_fact').upsert({
                    media_id: media.id,
                    metric_code: `profile_activity_${action}`,
                    period_code: 'lifetime',
                    snapshot_at: snapshotAt,
                    value: typeof r.value === 'number' ? r.value : null,
                  }, { onConflict: 'media_id,metric_code,period_code,snapshot_at' })
                }
              }
            } catch (paErr) {
              console.warn('[insight-collector] profile_activity insights failed (non-fatal)', {
                account_id: account.id,
                media_id: media.id,
                platform_media_id: media.platform_media_id,
                media_product_type: media.media_product_type ?? media.media_type,
                error: paErr instanceof Error ? paErr.message : String(paErr),
              })
            }
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
          total_value?: {
            value?: number
            breakdowns?: Array<{
              dimension_keys?: string[]
              results?: Array<{ dimension_values?: string[]; value?: number }>
            }>
          }
        }
        let acctUpsertCount = 0

        const upsertAccountBreakdownRows = async (params: {
          metricName: string
          breakdownKey: string
          valueDate: string
          periodCode: string
          row: AcctRow
        }) => {
          const results =
            params.row.total_value?.breakdowns?.flatMap(b => b.results ?? []) ?? []
          for (const r of results) {
            const dims = (r.dimension_values ?? []).map(v => String(v))
            const dimVal = dims.length ? dims.join('|') : ''
            if (!dimVal) continue
            const { error: upsertErr } = await admin.from('ig_account_insight_fact').upsert({
              account_id: account.id,
              metric_code: params.metricName,
              dimension_code: params.breakdownKey,
              dimension_value: dimVal,
              period_code: params.periodCode,
              value_date: params.valueDate,
              value: typeof r.value === 'number' ? r.value : null,
              fetched_at: new Date().toISOString(),
            }, { onConflict: 'account_id,metric_code,period_code,value_date,dimension_code,dimension_value' })
            if (upsertErr) {
              console.error('[insight-collector] breakdown upsert failed', {
                metric: params.metricName,
                breakdown: params.breakdownKey,
                dim: dimVal,
                date: params.valueDate,
                error: upsertErr.message,
              })
            } else {
              acctUpsertCount++
            }
          }
        }

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
            const { data: tvData } = await igClient.getAccountInsightsTotalValueExtended(daySince, dayUntil)
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

          // --- (B2) breakdown 付きアカウント指標（1日レンジ） ---
          const breakdownPairs: Array<[
            'reach' | 'views',
            'media_product_type' | 'follow_type' | 'follower_type',
          ]> = [
            ['reach', 'media_product_type'],
            ['reach', 'follow_type'],
            ['views', 'follower_type'],
            ['views', 'media_product_type'],
          ]

          for (const [metric, breakdown] of breakdownPairs) {
            try {
              const { data: bdData, rateUsage: bdRate } = await igClient.getAccountInsightsBreakdownTotalValue({
                since: daySince,
                until: dayUntil,
                metric,
                breakdown,
              })
              if (isRateLimitExceeded(bdRate, 70)) {
                console.warn('[insight-collector] rate usage high, stopping breakdown fetches for day', {
                  account_id: account.id,
                  date: daySince,
                  rate_usage: bdRate,
                })
                break
              }
              const bdArr = (bdData as { data: AcctRow[] })?.data ?? []
              const row = bdArr.find(r => r.name === metric)
              if (row) {
                await upsertAccountBreakdownRows({
                  metricName: metric,
                  breakdownKey: breakdown,
                  valueDate: daySince,
                  periodCode: 'day',
                  row,
                })
              }
            } catch (bdErr) {
              console.warn('[insight-collector] account breakdown fetch failed (non-fatal)', {
                account_id: account.id,
                date: daySince,
                metric,
                breakdown,
                error: bdErr instanceof Error ? bdErr.message : String(bdErr),
              })
            }
            await new Promise(resolve => setTimeout(resolve, 150))
          }

          // レート制限対策
          await new Promise(resolve => setTimeout(resolve, 200))
        }

        // --- (B3) デモグラフィック（lifetime + timeframe）※分析用途: 90日スナップショットを日次ジョブで更新 ---
        const demoTimeframe = 'last_90_days' as const
        const demoBreakdowns = ['country', 'age', 'gender', 'city'] as const
        const demoMetrics = ['engaged_audience_demographics', 'follower_demographics'] as const
        const demoAsOf = until // 直近インサイト取得ウィンドウの終端日をスナップショット日付として使う

        for (const demoMetric of demoMetrics) {
          for (const b of demoBreakdowns) {
            try {
              const { data: demoData, rateUsage: demoRate } = await igClient.getAccountInsightsDemographics({
                metric: demoMetric,
                timeframe: demoTimeframe,
                breakdown: b,
              })
              if (isRateLimitExceeded(demoRate, 70)) {
                console.warn('[insight-collector] rate usage high, stopping demographics fetches', {
                  account_id: account.id,
                  rate_usage: demoRate,
                })
                break
              }
              const demoArr = (demoData as { data: AcctRow[] })?.data ?? []
              const row = demoArr.find(r => r.name === demoMetric)
              if (row) {
                await upsertAccountBreakdownRows({
                  metricName: demoMetric,
                  breakdownKey: b,
                  valueDate: demoAsOf,
                  periodCode: 'lifetime',
                  row,
                })
              }
            } catch (demoErr) {
              console.warn('[insight-collector] demographics fetch failed (non-fatal)', {
                account_id: account.id,
                metric: demoMetric,
                breakdown: b,
                error: demoErr instanceof Error ? demoErr.message : String(demoErr),
              })
            }
            await new Promise(resolve => setTimeout(resolve, 150))
          }
        }

        // --- (B4) online_followers（取得できるアカウントのみ） ---
        try {
          const { data: olData, rateUsage: olRate } = await igClient.getAccountInsightsOnlineFollowers(since, until)
          if (!isRateLimitExceeded(olRate, 70)) {
            const olArr = (olData as { data: AcctRow[] })?.data ?? []
            const metric = olArr.find(m => m.name === 'online_followers')
            if (metric?.values?.length) {
              for (const v of metric.values) {
                const endDate = new Date(v.end_time)
                endDate.setDate(endDate.getDate() - 1)
                const valueDate = endDate.toISOString().slice(0, 10)
                const { error: upsertErr } = await admin.from('ig_account_insight_fact').upsert({
                  account_id: account.id,
                  metric_code: 'online_followers',
                  dimension_code: '',
                  dimension_value: '',
                  period_code: 'day',
                  value_date: valueDate,
                  value: v.value,
                  fetched_at: new Date().toISOString(),
                }, { onConflict: 'account_id,metric_code,period_code,value_date,dimension_code,dimension_value' })
                if (upsertErr) {
                  console.error('[insight-collector] online_followers upsert failed', {
                    date: valueDate, error: upsertErr.message,
                  })
                } else {
                  acctUpsertCount++
                }
              }
            }
          }
        } catch (olErr) {
          console.warn('[insight-collector] online_followers fetch failed (non-fatal)', {
            account_id: account.id,
            error: olErr instanceof Error ? olErr.message : String(olErr),
          })
        }

        // --- (C) follower_count: Insights API では取得不可のためプロフィールエンドポイントから取得 ---
        try {
          const { data: profileData } = await igClient.getProfileCounts()
          const pd = profileData as Record<string, unknown>
          const followerCount = typeof pd.followers_count === 'number' ? pd.followers_count : null
          if (followerCount !== null) {
            const today = new Date().toISOString().slice(0, 10)
            const { error: upsertErr } = await admin.from('ig_account_insight_fact').upsert({
              account_id: account.id,
              metric_code: 'follower_count',
              dimension_code: '',
              dimension_value: '',
              period_code: 'day',
              value_date: today,
              value: followerCount,
              fetched_at: new Date().toISOString(),
            }, { onConflict: 'account_id,metric_code,period_code,value_date,dimension_code,dimension_value' })
            if (upsertErr) {
              console.error('[insight-collector] follower_count upsert failed', {
                account_id: account.id, error: upsertErr.message,
              })
            } else {
              acctUpsertCount++
              console.info('[insight-collector] follower_count upserted', {
                account_id: account.id, value: followerCount, date: today,
              })
            }
          }
        } catch (fcErr) {
          console.warn('[insight-collector] follower_count fetch failed (non-fatal)', {
            account_id: account.id, error: fcErr instanceof Error ? fcErr.message : String(fcErr),
          })
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
    const insightStatus = totalFailed === 0 ? 'success' : 'partial'
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: insightStatus,
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
      status: insightStatus,
    })

    if (insightStatus !== 'success') {
      await notifyBatchError({
        jobName: 'insight_collector',
        processed: totalProcessed,
        errorCount: totalFailed,
        errors: [{ error: `${totalFailed} 件の insight 取得に失敗しました` }],
        executedAt: startedAt,
      })
    } else {
      await notifyBatchSuccess({
        jobName: 'insight_collector',
        processed: totalProcessed,
        executedAt: startedAt,
        lines: [
          `メディア insight 処理: ${totalProcessed} 件`,
          `アカウント insight upsert: ${acctInsightTotal} 件`,
        ],
      })
    }

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
    await notifyBatchError({
      jobName: 'insight_collector',
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
