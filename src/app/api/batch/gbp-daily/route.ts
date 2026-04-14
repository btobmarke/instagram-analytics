export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5分（Vercel Pro上限）

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getAccessTokenFromCredential, type GbpCredentialRow } from '@/lib/gbp/auth'
import { fetchPerformance, fetchReviews, listLocations } from '@/lib/gbp/api'
import { METRIC_TO_COLUMN } from '@/lib/gbp/constants'
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

// GET /api/batch/gbp-daily  ← Vercel Cron は GET で叩く
export async function GET(request: NextRequest) {
  // CRON_SECRET 認証
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    const qSecret    = new URL(request.url).searchParams.get('secret')
    const provided   = authHeader?.replace('Bearer ', '') ?? qSecret ?? ''
    if (provided !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  return runBatch(request)
}

// POST でも手動実行できるようにしておく
export async function POST(request: NextRequest) {
  return GET(request)
}

// ------------------------------------------------------------
// バッチ本体
// ------------------------------------------------------------
async function runBatch(_request: NextRequest) {
  const admin = createSupabaseAdminClient()
  const startedAt = new Date()

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
    return NextResponse.json({ error: 'batch_run insert failed' }, { status: 500 })
  }

  const batchRunId = batchRun.id
  const errors: Array<{ clientId: string; siteId?: string; error: string }> = []
  let processedSites = 0

  try {
    // 有効なGBP認証情報（クライアント単位）を全件取得
    const { data: credentials } = await admin
      .from('gbp_credentials')
      .select('*')
      .eq('auth_status', 'active')

    if (!credentials || credentials.length === 0) {
      await finalizeBatch(admin, batchRunId, 'success', [], 0)
      return NextResponse.json({ success: true, processed: 0, message: 'No active credentials' })
    }

    for (const cred of credentials as GbpCredentialRow[]) {
      // このクライアントのGBPサービス（有効なgbp_sites）を取得
      const { data: sites } = await admin
        .from('gbp_sites')
        .select(`
          id, gbp_location_name, gbp_title,
          services!inner(id, project_id, projects!inner(client_id))
        `)
        .eq('is_active', true)
        .filter('services.projects.client_id', 'eq', cred.client_id)

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

          // last_synced_at 更新
          await admin
            .from('gbp_sites')
            .update({ last_synced_at: new Date().toISOString() })
            .eq('id', siteId)

          processedSites++
          console.log(`[gbp-daily] site=${siteId} (${locationName}) done. performance=${rows.length}rows reviews=${reviews.length}`)

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
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
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

  return NextResponse.json({
    success: true,
    batch_run_id: batchRunId,
    target_date:  targetDateStr,
    processed:    processedSites,
    errors:       errors.length,
    status,
  })
}

async function finalizeBatch(
  admin: ReturnType<typeof createSupabaseAdminClient>,
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
