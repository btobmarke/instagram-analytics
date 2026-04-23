export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { InstagramApiError, InstagramClient, isRateLimitExceeded } from '@/lib/instagram/client'
import { legacyStoryMetricCodeFromNavigationDimension } from '@/lib/instagram/story-navigation-legacy-metric'
import { resolveClientIdFromServiceJoin } from '@/lib/batch/resolve-service-client-id'
import { decrypt } from '@/lib/utils/crypto'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { closeStaleRunningBatchLogs } from '@/lib/batch/close-stale-running-batch-logs'
import { coerceStoryInsightBigintValue } from '@/lib/batch/instagram-insight-metric-coerce'

function logStoryInsightError(ctx: Record<string, unknown>, err: unknown) {
  if (err instanceof InstagramApiError) {
    console.error('[story-insight-collector] failed', {
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
  console.error('[story-insight-collector] failed', { ...ctx, error: message }, err)
}

// POST /api/batch/story-insight-collector
// 毎時実行: 直近24時間のストーリーインサイトを収集
export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()
  let totalProcessed = 0
  let totalFailed = 0

  await closeStaleRunningBatchLogs(admin, ['hourly_story_insight_collector'])

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'hourly_story_insight_collector',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  console.info('[story-insight-collector] start', { job_id: jobLog?.id ?? null })

  try {
    const { data: accounts, error: accountsError } = await admin
      .from('ig_accounts')
      .select('id, platform_account_id, api_base_url, api_version, service_id')
      .eq('status', 'active')
      .not('service_id', 'is', null)

    console.info('[story-insight-collector] accounts found', {
      count: accounts?.length ?? 0,
      error: accountsError?.message ?? null,
    })

    // 1時間に1回のスナップショットとして、fetched_at は「時」で丸める（同一時間帯の再実行を upsert で吸収）
    const snapshotAt = new Date()
    snapshotAt.setMinutes(0, 0, 0)
    const snapshotAtIso = snapshotAt.toISOString()

    for (const account of (accounts ?? [])) {
      try {
        // service_id → project_id → client_id → client_ig_tokens
        const { data: svcRow } = await admin
          .from('services')
          .select('project_id, projects!inner(client_id)')
          .eq('id', account.service_id!)
          .single()

        const clientId = resolveClientIdFromServiceJoin(svcRow)
        if (!clientId) {
          console.warn('[story-insight-collector] skip account (cannot resolve client)', {
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
          console.warn('[story-insight-collector] skip account (no active token for client)', {
            account_id: account.id,
            client_id: clientId,
            token_error: tokenError?.message ?? null,
          })
          continue
        }

        const accessToken = decrypt(tokenRow.access_token_enc)
        const igClient = new InstagramClient(accessToken, account.platform_account_id, {
          apiBaseUrl: account.api_base_url ?? undefined,
          apiVersion: account.api_version ?? undefined,
        })

        // 直近24時間のストーリーのみ
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: storyList, error: storyListError } = await admin
          .from('ig_media')
          .select('id, platform_media_id, posted_at')
          .eq('account_id', account.id)
          .eq('is_deleted', false)
          .eq('media_product_type', 'STORY')
          .gte('posted_at', since)
          .order('posted_at', { ascending: false })
          .limit(50)

        console.info('[story-insight-collector] stories to process', {
          account_id: account.id,
          story_count: storyList?.length ?? 0,
          error: storyListError?.message ?? null,
        })

        for (const story of (storyList ?? [])) {
          try {
            const { data: insightData, rateUsage } = await igClient.getMediaInsights(story.platform_media_id, 'STORY')

            if (isRateLimitExceeded(rateUsage, 70)) {
              console.warn('[story-insight-collector] rate usage high, stopping story loop for account', {
                account_id: account.id,
                rate_usage: rateUsage,
              })
              break
            }

            const insights = (insightData as {
              data: Array<{ name: string; values?: Array<{ value: number }>; value?: number; total_value?: { value?: number } }>
            })?.data ?? []

            for (const insight of insights) {
              const raw =
                insight.values?.[0]?.value ??
                insight.value ??
                (typeof insight.total_value?.value === 'number' ? insight.total_value.value : null)
              const value = coerceStoryInsightBigintValue(raw)

              const { error: upsertErr } = await admin.from('ig_story_insight_fact').upsert({
                media_id: story.id,
                metric_code: insight.name,
                value,
                fetched_at: snapshotAtIso,
              }, { onConflict: 'media_id,metric_code,fetched_at' })
              if (upsertErr) {
                console.error('[story-insight-collector] ig_story_insight_fact upsert failed', {
                  account_id: account.id,
                  media_id: story.id,
                  metric_code: insight.name,
                  error: upsertErr.message,
                })
                throw upsertErr
              }
            }

            type NavFetchResult = Awaited<ReturnType<InstagramClient['getMediaStoryNavigationInsights']>>
            let navRes: NavFetchResult | null = null
            try {
              navRes = await igClient.getMediaStoryNavigationInsights(story.platform_media_id)
            } catch (navFetchErr) {
              console.warn('[story-insight-collector] story navigation insights fetch failed (non-fatal)', {
                account_id: account.id,
                media_id: story.id,
                platform_media_id: story.platform_media_id,
                error: navFetchErr instanceof Error ? navFetchErr.message : String(navFetchErr),
              })
            }
            if (navRes != null && !isRateLimitExceeded(navRes.rateUsage, 70)) {
              type NavInsight = {
                name: string
                total_value?: {
                  breakdowns?: Array<{
                    results?: Array<{ dimension_values?: string[]; value?: number }>
                  }>
                }
              }
              const navArr = (navRes.data as { data: NavInsight[] })?.data ?? []
              const nav = navArr.find(n => n.name === 'navigation')
              const results = nav?.total_value?.breakdowns?.flatMap(b => b.results ?? []) ?? []
              for (const r of results) {
                const action = (r.dimension_values?.[0] ?? '').toLowerCase()
                if (!action) continue
                const navVal = coerceStoryInsightBigintValue(r.value)
                const { error: navUpsertErr } = await admin.from('ig_story_insight_fact').upsert({
                  media_id: story.id,
                  metric_code: `navigation_${action}`,
                  value: navVal,
                  fetched_at: snapshotAtIso,
                }, { onConflict: 'media_id,metric_code,fetched_at' })
                if (navUpsertErr) {
                  console.error('[story-insight-collector] navigation upsert failed', {
                    account_id: account.id,
                    media_id: story.id,
                    metric_code: `navigation_${action}`,
                    error: navUpsertErr.message,
                  })
                  throw navUpsertErr
                }
                const legacyCode = legacyStoryMetricCodeFromNavigationDimension(action)
                if (legacyCode != null) {
                  const { error: legacyErr } = await admin.from('ig_story_insight_fact').upsert({
                    media_id: story.id,
                    metric_code: legacyCode,
                    value: navVal,
                    fetched_at: snapshotAtIso,
                  }, { onConflict: 'media_id,metric_code,fetched_at' })
                  if (legacyErr) {
                    console.error('[story-insight-collector] navigation→legacy metric upsert failed', {
                      account_id: account.id,
                      media_id: story.id,
                      metric_code: legacyCode,
                      error: legacyErr.message,
                    })
                    throw legacyErr
                  }
                }
              }
            } else if (navRes != null && isRateLimitExceeded(navRes.rateUsage, 70)) {
              console.warn('[story-insight-collector] rate usage high after story navigation fetch', {
                account_id: account.id,
                rate_usage: navRes.rateUsage,
              })
            }

            totalProcessed++
          } catch (err) {
            totalFailed++
            logStoryInsightError({
              account_id: account.id,
              platform_account_id: account.platform_account_id,
              media_id: story.id,
              platform_media_id: story.platform_media_id,
            }, err)
          }

          await new Promise(resolve => setTimeout(resolve, 100))
        }
      } catch (err) {
        totalFailed++
        logStoryInsightError({
          account_id: account.id,
          platform_account_id: account.platform_account_id,
        }, err)
      }
    }

    const duration = Date.now() - startedAt.getTime()
    const status = totalFailed === 0 ? 'success' : 'partial'
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status,
        records_processed: totalProcessed,
        records_failed: totalFailed,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      }).eq('id', jobLog.id)
    }

    console.info('[story-insight-collector] done', {
      job_id: jobLog?.id ?? null,
      processed: totalProcessed,
      failed: totalFailed,
      duration_ms: duration,
      status,
    })

    if (status !== 'success') {
      await notifyBatchError({
        jobName: 'story_insight_collector',
        processed: totalProcessed,
        errorCount: totalFailed,
        errors: [{ error: `${totalFailed} 件の story insight 取得に失敗しました` }],
        executedAt: startedAt,
      })
    } else {
      await notifyBatchSuccess({
        jobName: 'story_insight_collector',
        processed: totalProcessed,
        executedAt: startedAt,
        lines: [`ストーリー insight 処理: ${totalProcessed} 件`],
      })
    }

    return NextResponse.json({
      success: totalFailed === 0,
      processed: totalProcessed,
      failed: totalFailed,
      snapshot_at: snapshotAtIso,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[story-insight-collector] fatal', { job_id: jobLog?.id ?? null, error: message }, err)
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'story_insight_collector',
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

