import type { SupabaseClient } from '@supabase/supabase-js'
import { InstagramApiError, InstagramClient, isRateLimitExceeded } from '@/lib/instagram/client'
import { legacyStoryMetricCodeFromNavigationDimension } from '@/lib/instagram/story-navigation-legacy-metric'
import { resolveClientIdFromServiceJoin } from '@/lib/batch/resolve-service-client-id'
import { decrypt } from '@/lib/utils/crypto'

/** `ig_story_insight_fact.value` は BIGINT。非有限・範囲外は null */
function toStoryInsightBigintValue(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.round(v)
  const MAX = 9223372036854775807
  const MIN = -9223372036854775808
  if (n > MAX || n < MIN) return null
  return n
}

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

export type StoryInsightCollectorAccountRow = {
  id: string
  platform_account_id: string
  api_base_url: string | null
  api_version: string | null
  service_id: string | null
}

/** 直近24hストーリーインサイト。job_log / notify は呼び出し側。 */
export async function runStoryInsightCollectorForAccounts(
  admin: SupabaseClient,
  accounts: StoryInsightCollectorAccountRow[]
): Promise<{ totalProcessed: number; totalFailed: number; snapshotAtIso: string }> {
  let totalProcessed = 0
  let totalFailed = 0

  const snapshotAt = new Date()
  snapshotAt.setMinutes(0, 0, 0)
  const snapshotAtIso = snapshotAt.toISOString()

  for (const account of accounts) {
    try {
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

      for (const story of storyList ?? []) {
        try {
          const { data: insightData, rateUsage } = await igClient.getMediaInsights(story.platform_media_id, 'STORY')

          if (isRateLimitExceeded(rateUsage, 70)) {
            console.warn('[story-insight-collector] rate usage high, stopping story loop for account', {
              account_id: account.id,
              rate_usage: rateUsage,
            })
            break
          }

          const insights = (
            insightData as {
              data: Array<{
                name: string
                values?: Array<{ value: number }>
                value?: number
                total_value?: { value?: number }
              }>
            }
          )?.data ?? []

          for (const insight of insights) {
            const raw =
              insight.values?.[0]?.value ??
              insight.value ??
              (typeof insight.total_value?.value === 'number' ? insight.total_value.value : null)
            const value = toStoryInsightBigintValue(raw)

            const { error: upsertErr } = await admin.from('ig_story_insight_fact').upsert(
              {
                media_id: story.id,
                metric_code: insight.name,
                value,
                fetched_at: snapshotAtIso,
              },
              { onConflict: 'media_id,metric_code,fetched_at' }
            )
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
              const navVal = toStoryInsightBigintValue(r.value)
              const { error: navUpsertErr } = await admin.from('ig_story_insight_fact').upsert(
                {
                  media_id: story.id,
                  metric_code: `navigation_${action}`,
                  value: navVal,
                  fetched_at: snapshotAtIso,
                },
                { onConflict: 'media_id,metric_code,fetched_at' }
              )
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
                const { error: legacyErr } = await admin.from('ig_story_insight_fact').upsert(
                  {
                    media_id: story.id,
                    metric_code: legacyCode,
                    value: navVal,
                    fetched_at: snapshotAtIso,
                  },
                  { onConflict: 'media_id,metric_code,fetched_at' }
                )
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
          logStoryInsightError(
            {
              account_id: account.id,
              platform_account_id: account.platform_account_id,
              media_id: story.id,
              platform_media_id: story.platform_media_id,
            },
            err
          )
        }

        await new Promise(resolve => setTimeout(resolve, 100))
      }
    } catch (err) {
      totalFailed++
      logStoryInsightError(
        {
          account_id: account.id,
          platform_account_id: account.platform_account_id,
        },
        err
      )
    }
  }

  return { totalProcessed, totalFailed, snapshotAtIso }
}
