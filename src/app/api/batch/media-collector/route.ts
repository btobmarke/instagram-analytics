export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { InstagramApiError } from '@/lib/instagram/client'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { runMediaCollectorForAccount } from '@/lib/batch/media-collector-one-account'

// POST /api/batch/media-collector
// Vercel Cron or manual trigger: 投稿一覧の同期
export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const accountIdFilter = typeof body.account_id === 'string' ? body.account_id : undefined

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()
  let totalProcessed = 0
  let totalFailed = 0
  let skippedNoToken = 0
  let skippedNoClient = 0
  let storyListFetchFailures = 0
  let storyRateLimitEarlyStops = 0
  let lastErrorMessage: string | null = null
  let tokenInvalid = false

  // バッチ開始ログ
  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'daily_media_collector',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  console.info('[media-collector] start', { job_id: jobLog?.id ?? null })

  try {
    // アクティブなアカウント一覧取得
    let acctQ = admin
      .from('ig_accounts')
      .select('id, platform_account_id, api_base_url, api_version, service_id')
      .eq('status', 'active')
      .not('service_id', 'is', null)
    if (accountIdFilter) acctQ = acctQ.eq('id', accountIdFilter)
    const { data: accounts } = await acctQ

    for (const account of (accounts ?? [])) {
      try {
        const r = await runMediaCollectorForAccount(admin, account)
        if (r.skippedNoClient) {
          skippedNoClient++
          console.warn('[media-collector] skip account (cannot resolve client)', {
            account_id: account.id,
            service_id: account.service_id,
          })
          continue
        }
        if (r.skippedNoToken) {
          skippedNoToken++
          console.warn('[media-collector] skip account (no active token for client)', {
            account_id: account.id,
          })
          continue
        }
        if (r.storyListFetchFailures) storyListFetchFailures += 1
        if (r.storyRateLimitEarlyStops) storyRateLimitEarlyStops += 1
        if (r.tokenInvalid) tokenInvalid = true
        totalProcessed += r.processed
        totalFailed += r.failed
      } catch (loopErr) {
        totalFailed++
        const msg = loopErr instanceof Error ? loopErr.message : String(loopErr)
        lastErrorMessage = msg
        if (loopErr instanceof InstagramApiError && loopErr.apiError?.code === 190) {
          tokenInvalid = true
        }
        console.error('[media-collector] account failed', { account_id: account.id, error: loopErr })
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

    console.info('[media-collector] done', {
      job_id: jobLog?.id ?? null,
      processed: totalProcessed,
      failed: totalFailed,
      skipped_no_token: skippedNoToken,
      skipped_no_client: skippedNoClient,
      story_list_fetch_failures: storyListFetchFailures,
      story_rate_limit_early_stops: storyRateLimitEarlyStops,
      token_invalid: tokenInvalid,
      duration_ms: duration,
      status: totalFailed === 0 ? 'success' : 'partial',
    })

    if (totalFailed === 0) {
      await notifyBatchSuccess({
        jobName: 'daily_media_collector',
        processed: totalProcessed,
        executedAt: startedAt,
        lines: [
          `対象: アカウント数 ${(accounts ?? []).length} 件`,
          `クライアント解決不可でスキップ: ${skippedNoClient} 件`,
          `トークン未設定でスキップ: ${skippedNoToken} 件`,
          ...(storyListFetchFailures > 0 || storyRateLimitEarlyStops > 0
            ? [
                `ストーリー一覧: 取得失敗 ${storyListFetchFailures} アカウント / レート制限打切り ${storyRateLimitEarlyStops} アカウント`,
              ]
            : []),
        ],
      })
    } else {
      await notifyBatchError({
        jobName: 'daily_media_collector',
        processed: totalProcessed,
        errorCount: totalFailed,
        errors: [{ error: lastErrorMessage ?? `${totalFailed} 件の処理で失敗しました` }],
        executedAt: startedAt,
      })
    }

    return NextResponse.json({
      success: totalFailed === 0,
      processed: totalProcessed,
      failed: totalFailed,
      accounts: (accounts ?? []).length,
      skipped_no_token: skippedNoToken,
      skipped_no_client: skippedNoClient,
      story_list_fetch_failures: storyListFetchFailures,
      story_rate_limit_early_stops: storyRateLimitEarlyStops,
      ...(tokenInvalid ? { token_invalid: true as const } : {}),
      ...(lastErrorMessage ? { last_error: lastErrorMessage } : {}),
      ...(tokenInvalid
        ? {
            hint_ja:
              'アクセストークンが無効です（期限切れ・ログアウト・権限失効）。Meta で新しい長期トークンを発行し、アカウントのトークンを差し替えてください。',
          }
        : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[media-collector] fatal', { job_id: jobLog?.id ?? null, error: message }, err)
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'daily_media_collector',
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
