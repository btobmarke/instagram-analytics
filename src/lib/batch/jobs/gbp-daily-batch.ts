import type { SupabaseClient } from '@supabase/supabase-js'
import { getAccessTokenFromCredential, type GbpCredentialRow } from '@/lib/gbp/auth'
import {
  fetchPerformance,
  fetchReviews,
  fetchSearchKeywordImpressionsMonthly,
  listLocations,
} from '@/lib/gbp/api'
import { METRIC_TO_COLUMN } from '@/lib/gbp/constants'
import { syncGbpReviewStarCountsDaily } from '@/lib/gbp/sync-review-star-counts-daily'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

// JSTで「今日」の日付文字列を返す
function jstToday(): Date {
  const now = new Date()
  // UTC+9
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
}

function dateToString(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** JST の「先月」（検索キーワード月次は翌月初旬まで遅延しがちなため、当月は取らない） */
function previousCalendarMonthJst(now = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  const y = Number(parts.find(p => p.type === 'year')?.value ?? '0')
  let m = Number(parts.find(p => p.type === 'month')?.value ?? '0')
  m -= 1
  let year = y
  if (m < 1) {
    m = 12
    year -= 1
  }
  return { year, month: m }
}

/** 1〜12 の月に delta を加算（delta は負可） */
function addCalendarMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx0 = year * 12 + (month - 1) + delta
  return { year: Math.floor(idx0 / 12), month: (idx0 % 12) + 1 }
}

async function finalizeBatch(
  admin: SupabaseClient,
  batchRunId: string,
  status: string,
  errors: unknown[],
  processed: number,
) {
  await admin
    .from('gbp_batch_runs')
    .update({
      finished_at:   new Date().toISOString(),
      status,
      error_summary: errors.length > 0 ? { errors, processed } : null,
    })
    .eq('id', batchRunId)
}

export type GbpDailyBatchResult = {
  success: boolean
  batch_run_id?: string
  target_date?: string
  processed?: number
  errors?: number
  status?: string
  message?: string
  error?: string
}

export async function runGbpDailyBatch(
  admin: SupabaseClient,
  opts: { siteId: string | null }
): Promise<GbpDailyBatchResult> {
  const startedAt = new Date()
  const siteFilter = opts.siteId

  // target_date = JST昨日 から GBP_DATE_OFFSET_DAYS 日前まで
  const offsetDays = Number(process.env.GBP_DATE_OFFSET_DAYS ?? '1')
  const days       = 7

  const today     = jstToday()
  const targetDate = new Date(today)
  targetDate.setDate(today.getDate() - offsetDays)
  const startDate = new Date(targetDate)
  startDate.setDate(targetDate.getDate() - (days - 1))

  const targetDateStr = dateToString(targetDate)

  // batch_job_logs INSERT
  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'gbp_daily',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  // バッチ実行レコード INSERT
  const { data: batchRun, error: batchInsertErr } = await admin
    .from('gbp_batch_runs')
    .insert({
      trigger:     'vercel_cron',
      target_date: targetDateStr,
      days,
      status:      'running',
    })
    .select('id')
    .single()

  if (batchInsertErr || !batchRun) {
    console.error('[gbp-daily] batch_run insert error:', batchInsertErr)
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: 'batch_run insert failed',
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    return { success: false, error: 'batch_run insert failed' }
  }

  const batchRunId = batchRun.id
  const errors: Array<{ clientId: string; siteId?: string; error: string }> = []
  let processedSites = 0

  try {
    let credentials: GbpCredentialRow[] = []

    if (siteFilter) {
      const { data: siteOne, error: siteErr } = await admin
        .from('gbp_sites')
        .select(
          `
          id, gbp_location_name, gbp_title, gbp_account_name,
          services!inner(id, project_id, projects!inner(client_id))
        `
        )
        .eq('id', siteFilter)
        .eq('is_active', true)
        .maybeSingle()

      if (siteErr || !siteOne) {
        errors.push({ clientId: 'unknown', siteId: siteFilter, error: 'site not found or inactive' })
        throw new Error(siteErr?.message ?? 'site not found')
      }

      const svc = siteOne.services as unknown as { projects: { client_id: string } }
      const clientId = svc?.projects?.client_id
      if (!clientId) {
        errors.push({ clientId: 'unknown', siteId: siteFilter, error: 'client_id not resolved' })
        throw new Error('client_id not resolved')
      }

      const { data: credOne } = await admin
        .from('gbp_credentials')
        .select('*')
        .eq('client_id', clientId)
        .eq('auth_status', 'active')
        .maybeSingle()

      if (!credOne) {
        errors.push({ clientId: clientId, siteId: siteFilter, error: 'no active gbp_credentials' })
        throw new Error('no active credentials for site client')
      }

      credentials = [credOne as GbpCredentialRow]
    } else {
      const { data: creds } = await admin.from('gbp_credentials').select('*').eq('auth_status', 'active')
      credentials = (creds ?? []) as GbpCredentialRow[]
    }

    if (credentials.length === 0) {
      await finalizeBatch(admin, batchRunId, 'success', [], 0)
      return { success: true, processed: 0, message: 'No active credentials' }
    }

    for (const cred of credentials) {
      // このクライアントのGBPサービス（有効なgbp_sites）を取得
      let sitesQuery = admin
        .from('gbp_sites')
        .select(`
          id, gbp_location_name, gbp_title, gbp_account_name,
          services!inner(id, project_id, projects!inner(client_id))
        `)
        .eq('is_active', true)
        .filter('services.projects.client_id', 'eq', cred.client_id)

      if (siteFilter) sitesQuery = sitesQuery.eq('id', siteFilter)

      const { data: sites } = await sitesQuery

      if (!sites || sites.length === 0) continue

      // アクセストークンをクライアント単位で1回取得
      let accessToken: string
      try {
        accessToken = await getAccessTokenFromCredential(cred)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[gbp-daily] client=${cred.client_id} token refresh failed:`, msg)

        // 認証エラーなら auth_status を error に
        if (msg.includes('invalid_grant') || msg.includes('invalid_client')) {
          await admin
            .from('gbp_credentials')
            .update({ auth_status: 'error' })
            .eq('client_id', cred.client_id)
        }

        errors.push({ clientId: cred.client_id, error: `token_refresh: ${msg}` })
        continue
      }

      // gbp_account_name が未設定のサイトがある場合、listLocations で解決する
      const sitesNeedingAccount = (sites as Array<{ id: string; gbp_location_name: string; gbp_account_name: string | null; gbp_title: string | null; services: unknown }>)
        .filter(s => !s.gbp_account_name)

      if (sitesNeedingAccount.length > 0) {
        try {
          const allLocs = await listLocations(accessToken)
          const locMap = new Map(allLocs.map(l => [l.name, l.accountName]))
          for (const site of sitesNeedingAccount) {
            const accountName = locMap.get(site.gbp_location_name)
            if (accountName) {
              await admin.from('gbp_sites').update({ gbp_account_name: accountName }).eq('id', site.id)
              site.gbp_account_name = accountName
            }
          }
        } catch (err) {
          console.warn('[gbp-daily] listLocations for account resolve failed:', err)
        }
      }

      for (const site of sites as Array<{ id: string; gbp_location_name: string; gbp_account_name: string | null; gbp_title: string | null; services: unknown }>) {
        const siteId = site.id
        const locationName = site.gbp_location_name
        const accountName = site.gbp_account_name

        try {
          // ---- Performance UPSERT ----
          const rows = await fetchPerformance({
            accessToken,
            locationName,
            startDate,
            endDate: targetDate,
          })

          if (rows.length > 0) {
            const upsertData = rows.map(row => ({
              gbp_site_id:  siteId,
              date:         row.date,
              ...Object.fromEntries(
                Object.entries(METRIC_TO_COLUMN).map(([, col]) => [col, row.metrics[col] ?? null])
              ),
              raw_payload:  row.rawPayload ?? null,
              updated_at:   new Date().toISOString(),
            }))

            const { error: perfErr } = await admin
              .from('gbp_performance_daily')
              .upsert(upsertData, { onConflict: 'gbp_site_id,date' })

            if (perfErr) {
              console.error(`[gbp-daily] site=${siteId} performance upsert error:`, perfErr)
              errors.push({ clientId: cred.client_id, siteId, error: `performance: ${perfErr.message}` })
            }
          }

          // ---- 検索キーワード（月次インプレッション）UPSERT ----
          let keywordRowsTotal = 0
          try {
            const monthsBack = Math.min(
              36,
              Math.max(1, parseInt(process.env.GBP_KEYWORD_MONTHS_BACK ?? '13', 10) || 13),
            )
            const endYm = previousCalendarMonthJst()
            keywordMonths: for (let i = monthsBack - 1; i >= 0; i--) {
              const { year, month } = addCalendarMonths(endYm.year, endYm.month, -i)
              const items = await fetchSearchKeywordImpressionsMonthly({
                accessToken,
                locationName,
                year,
                month,
              })
              if (items.length === 0) continue

              const CHUNK = 200
              for (let j = 0; j < items.length; j += CHUNK) {
                const slice = items.slice(j, j + CHUNK)
                const kwUpsert = slice.map(it => ({
                  gbp_site_id:    siteId,
                  year,
                  month,
                  search_keyword: it.searchKeyword,
                  impressions:    it.impressions,
                  threshold:      it.threshold,
                  updated_at:     new Date().toISOString(),
                }))
                const { error: kwErr } = await admin
                  .from('gbp_search_keyword_monthly')
                  .upsert(kwUpsert, { onConflict: 'gbp_site_id,year,month,search_keyword' })
                if (kwErr) {
                  console.error(`[gbp-daily] site=${siteId} search keywords ${year}-${month} upsert error:`, kwErr)
                  errors.push({ clientId: cred.client_id, siteId, error: `search_keywords: ${kwErr.message}` })
                  break keywordMonths
                }
              }
              keywordRowsTotal += items.length
            }
          } catch (kwFatal) {
            const msg = kwFatal instanceof Error ? kwFatal.message : String(kwFatal)
            console.warn(`[gbp-daily] site=${siteId} search keywords fetch failed (non-fatal):`, msg)
            errors.push({ clientId: cred.client_id, siteId, error: `search_keywords: ${msg}` })
          }

          // ---- Reviews UPSERT ----
          const reviews = accountName
            ? await fetchReviews({ accessToken, locationName, accountName })
            : []
          if (!accountName) {
            console.warn(`[gbp-daily] site=${siteId} gbp_account_name が未解決のためレビューをスキップ`)
          }

          if (reviews.length > 0) {
            const reviewUpsertData = reviews.map(r => ({
              gbp_site_id:       siteId,
              batch_run_id:      batchRunId,
              review_id:         r.reviewId,
              star_rating:       r.starRating,
              comment:           r.comment ?? null,
              reviewer_name:     r.reviewer?.displayName ?? null,
              reviewer_photo_url: r.reviewer?.profilePhotoUrl ?? null,
              create_time:       r.createTime,
              update_time:       r.updateTime ?? null,
              reply_comment:     r.reviewReply?.comment ?? null,
              reply_update_time: r.reviewReply?.updateTime ?? null,
              collected_at:      new Date().toISOString(),
            }))

            const { error: reviewErr } = await admin
              .from('gbp_reviews')
              .upsert(reviewUpsertData, { onConflict: 'gbp_site_id,review_id' })

            if (reviewErr) {
              console.error(`[gbp-daily] site=${siteId} reviews upsert error:`, reviewErr)
              errors.push({ clientId: cred.client_id, siteId, error: `reviews: ${reviewErr.message}` })
            }
          }

          // クチコミ星別・日次集計（gbp_reviews 全件から再計算。星なし = UNSPECIFIED / NULL / 想定外）
          if (accountName) {
            try {
              await syncGbpReviewStarCountsDaily(admin, siteId)
            } catch (starErr) {
              const msg = starErr instanceof Error ? starErr.message : String(starErr)
              console.error(`[gbp-daily] site=${siteId} review_star_counts_daily sync error:`, msg)
              errors.push({ clientId: cred.client_id, siteId, error: `review_star_counts: ${msg}` })
            }
          }

          // last_synced_at 更新
          await admin
            .from('gbp_sites')
            .update({ last_synced_at: new Date().toISOString() })
            .eq('id', siteId)

          processedSites++
          console.log(
            `[gbp-daily] site=${siteId} (${locationName}) done. performance=${rows.length}rows keywords=${keywordRowsTotal} reviews=${reviews.length}`,
          )

        } catch (siteErr) {
          const msg = siteErr instanceof Error ? siteErr.message : String(siteErr)
          console.error(`[gbp-daily] site=${siteId} error:`, msg)
          errors.push({ clientId: cred.client_id, siteId, error: msg })
        }
      }
    }
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr)
    console.error('[gbp-daily] fatal error:', msg)
    await finalizeBatch(admin, batchRunId, 'failed', [{ clientId: 'all', error: msg }], processedSites)
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        records_processed: processedSites,
        records_failed: 1,
        error_message: msg,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'gbp_daily',
      processed: processedSites,
      errorCount: 1,
      errors: [{ error: msg }],
      executedAt: startedAt,
    })
    return { success: false, error: msg }
  }

  const status = errors.length === 0 ? 'success' : (processedSites > 0 ? 'partial' : 'failed')
  await finalizeBatch(admin, batchRunId, status, errors, processedSites)

  if (jobLog) {
    await admin.from('batch_job_logs').update({
      status,
      records_processed: processedSites,
      records_failed: errors.length,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
    }).eq('id', jobLog.id)
  }

  if (status !== 'success') {
    await notifyBatchError({
      jobName: 'gbp_daily',
      processed: processedSites,
      errorCount: errors.length,
      errors,
      executedAt: startedAt,
    })
  } else {
    await notifyBatchSuccess({
      jobName: 'gbp_daily',
      processed: processedSites,
      executedAt: startedAt,
      lines: [`対象日: ${targetDateStr}`, `集計日数: ${days} 日分`],
    })
  }

  return {
    success: true,
    batch_run_id: batchRunId,
    target_date: targetDateStr,
    processed: processedSites,
    errors: errors.length,
    status,
  }
}
