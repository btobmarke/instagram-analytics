import type { SupabaseClient } from "@supabase/supabase-js"
import { InstagramApiError, InstagramClient, isRateLimitExceeded } from "@/lib/instagram/client"
import { legacyStoryMetricCodeFromNavigationDimension } from "@/lib/instagram/story-navigation-legacy-metric"
import { resolveClientIdFromServiceJoin } from "@/lib/batch/resolve-service-client-id"
import { decrypt } from "@/lib/utils/crypto"
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
  admin: SupabaseClient,
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

export type InsightCollectorAccountRow = {
  id: string
  platform_account_id: string
  api_base_url: string | null
  api_version: string | null
  service_id: string | null
}

/** メディア＋アカウントインサイト収集（1件以上のアカウント行を想定）。job_log / notify は呼び出し側。 */
export async function runInsightCollectorForAccounts(
  admin: SupabaseClient,
  accounts: InsightCollectorAccountRow[]
): Promise<{ totalProcessed: number; totalFailed: number; acctInsightTotal: number }> {
  let totalProcessed = 0
  let totalFailed = 0
  let acctInsightTotal = 0

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

      const clientId = resolveClientIdFromServiceJoin(svcRow)

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
                  const legacyCode = legacyStoryMetricCodeFromNavigationDimension(action)
                  if (legacyCode != null) {
                    await admin.from('ig_media_insight_fact').upsert({
                      media_id: media.id,
                      metric_code: legacyCode,
                      period_code: 'lifetime',
                      snapshot_at: snapshotAt,
                      value: typeof r.value === 'number' ? r.value : null,
                    }, { onConflict: 'media_id,metric_code,period_code,snapshot_at' })
                  }
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

          // 投稿→プロフィール行動（profile_activity）— REELS/VIDEO は API が非対応 (#100)
          if (mediaType === 'FEED' || mediaType === 'STORY') {
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
          values?: Array<{ value: number | Record<string, number> | unknown; end_time: string }>
          total_value?: {
            value?: number | Record<string, number>
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
          // views のフォロワー内訳は API では breakdown=follow_type（v20+）。DB は既存カタログ互換で dimension_code=follower_type
          const breakdownPairs: Array<{
            metric: 'reach' | 'views'
            apiBreakdown: 'media_product_type' | 'follow_type'
            dimensionCode: string
          }> = [
            { metric: 'reach', apiBreakdown: 'media_product_type', dimensionCode: 'media_product_type' },
            { metric: 'reach', apiBreakdown: 'follow_type', dimensionCode: 'follow_type' },
            { metric: 'views', apiBreakdown: 'follow_type', dimensionCode: 'follower_type' },
            { metric: 'views', apiBreakdown: 'media_product_type', dimensionCode: 'media_product_type' },
          ]

          for (const { metric, apiBreakdown, dimensionCode } of breakdownPairs) {
            try {
              const { data: bdData, rateUsage: bdRate } = await igClient.getAccountInsightsBreakdownTotalValue({
                since: daySince,
                until: dayUntil,
                metric,
                breakdown: apiBreakdown,
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
                  breakdownKey: dimensionCode,
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
                apiBreakdown,
                dimensionCode,
                error: bdErr instanceof Error ? bdErr.message : String(bdErr),
              })
            }
            await new Promise(resolve => setTimeout(resolve, 150))
          }

          // レート制限対策
          await new Promise(resolve => setTimeout(resolve, 200))
        }

        // --- (B3) デモグラフィック（v20+ では last_N_days timeframe 廃止 → 省略 → this_month → this_week）
        const demoBreakdowns = ['country', 'age', 'gender', 'city'] as const
        const demoMetrics = ['engaged_audience_demographics', 'follower_demographics'] as const
        const demoAsOf = until

        const tryDemographicsFetch = async (params: {
          demoMetric: (typeof demoMetrics)[number]
          b: (typeof demoBreakdowns)[number]
          timeframe?: 'this_month' | 'this_week'
        }) => {
          const { data: demoData, rateUsage: demoRate } = await igClient.getAccountInsightsDemographics({
            metric: params.demoMetric,
            breakdown: params.b,
            ...(params.timeframe ? { timeframe: params.timeframe } : {}),
          })
          return { demoData, demoRate }
        }

        for (const demoMetric of demoMetrics) {
          for (const b of demoBreakdowns) {
            let lastErr: unknown = null
            let fetched = false
            for (const tf of [undefined, 'this_month' as const, 'this_week' as const]) {
              try {
                const { demoData, demoRate } = await tryDemographicsFetch({
                  demoMetric,
                  b,
                  timeframe: tf,
                })
                if (isRateLimitExceeded(demoRate, 70)) {
                  console.warn('[insight-collector] rate usage high, stopping demographics fetches', {
                    account_id: account.id,
                    rate_usage: demoRate,
                  })
                  fetched = true
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
                  fetched = true
                  break
                }
              } catch (e) {
                lastErr = e
              }
              await new Promise(resolve => setTimeout(resolve, 80))
            }
            if (!fetched) {
              console.warn('[insight-collector] demographics fetch failed (non-fatal)', {
                account_id: account.id,
                metric: demoMetric,
                breakdown: b,
                tried_timeframes: ['(omit)', 'this_month', 'this_week'],
                error: lastErr instanceof Error ? lastErr.message : String(lastErr),
              })
            }
            await new Promise(resolve => setTimeout(resolve, 150))
          }
        }

        /** online_followers: API が number または 0–23 のオブジェクトで返す場合がある */
        const coerceOnlineFollowersScalar = (val: unknown): number | null => {
          if (typeof val === 'number' && Number.isFinite(val)) return val
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            let sum = 0
            for (const x of Object.values(val as Record<string, unknown>)) {
              if (typeof x === 'number' && Number.isFinite(x)) sum += x
            }
            return sum > 0 ? sum : null
          }
          return null
        }

        // --- (B4) online_followers（metric_type=total_value + period=day） ---
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
                const scalar = coerceOnlineFollowersScalar(v.value)
                if (scalar == null) continue
                const { error: upsertErr } = await admin.from('ig_account_insight_fact').upsert({
                  account_id: account.id,
                  metric_code: 'online_followers',
                  dimension_code: '',
                  dimension_value: '',
                  period_code: 'day',
                  value_date: valueDate,
                  value: scalar,
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
            } else if (metric) {
              const tv = metric.total_value?.value
              const scalar =
                typeof tv === 'number' && Number.isFinite(tv)
                  ? tv
                  : coerceOnlineFollowersScalar(tv)
              if (scalar != null) {
                const { error: upsertErr } = await admin.from('ig_account_insight_fact').upsert({
                  account_id: account.id,
                  metric_code: 'online_followers',
                  dimension_code: '',
                  dimension_value: '',
                  period_code: 'day',
                  value_date: until,
                  value: scalar,
                  fetched_at: new Date().toISOString(),
                }, { onConflict: 'account_id,metric_code,period_code,value_date,dimension_code,dimension_value' })
                if (!upsertErr) acctUpsertCount++
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
  return { totalProcessed, totalFailed, acctInsightTotal }
}

