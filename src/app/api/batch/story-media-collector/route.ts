export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { runInstagramStoryMediaSyncAllAccounts } from '@/lib/batch/sync-instagram-stories-media'

// POST /api/batch/story-media-collector
// 毎時実行: 公開中ストーリーを GET /{ig-user-id}/stories で取得し ig_media に反映
export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'hourly_story_media_collector',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  console.info('[story-media-collector] start', { job_id: jobLog?.id ?? null })

  try {
    const {
      totalProcessed,
      totalFailed,
      skippedNoToken,
      skippedNoClient,
      accountsCount,
      storyListFetchFailures,
      storyRateLimitEarlyStops,
    } = await runInstagramStoryMediaSyncAllAccounts(admin, 'story-media-collector')

    const duration = Date.now() - startedAt.getTime()
    const summaryLine =
      totalFailed > 0
        ? `ストーリー一覧取得失敗アカウント: ${storyListFetchFailures} 件 / レート制限で打切り: ${storyRateLimitEarlyStops} 件`
        : null
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: totalFailed === 0 ? 'success' : 'partial',
        records_processed: totalProcessed,
        records_failed: totalFailed,
        error_message: summaryLine,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      }).eq('id', jobLog.id)
    }

    console.info('[story-media-collector] done', {
      job_id: jobLog?.id ?? null,
      processed: totalProcessed,
      failed: totalFailed,
      skipped_no_token: skippedNoToken,
      skipped_no_client: skippedNoClient,
      accounts: accountsCount,
      story_list_fetch_failures: storyListFetchFailures,
      story_rate_limit_early_stops: storyRateLimitEarlyStops,
      duration_ms: duration,
    })

    if (totalFailed === 0) {
      await notifyBatchSuccess({
        jobName: 'hourly_story_media_collector',
        processed: totalProcessed,
        executedAt: startedAt,
        lines: [
          `対象アカウント数: ${accountsCount} 件`,
          `クライアント解決不可でスキップ: ${skippedNoClient} 件`,
          `トークン未設定でスキップ: ${skippedNoToken} 件`,
          ...(storyRateLimitEarlyStops > 0
            ? [`レート制限（X-App-Usage）でストーリー一覧の打切り: ${storyRateLimitEarlyStops} アカウント`]
            : []),
        ],
      })
    } else {
      await notifyBatchError({
        jobName: 'hourly_story_media_collector',
        processed: totalProcessed,
        errorCount: totalFailed,
        errors: [
          {
            error:
              summaryLine ??
              `${totalFailed} 件の処理で失敗しました（一覧取得失敗はアカウント単位でカウント）`,
          },
        ],
        executedAt: startedAt,
      })
    }

    return NextResponse.json({
      success: totalFailed === 0,
      processed: totalProcessed,
      failed: totalFailed,
      accounts: accountsCount,
      skipped_no_token: skippedNoToken,
      skipped_no_client: skippedNoClient,
      story_list_fetch_failures: storyListFetchFailures,
      story_rate_limit_early_stops: storyRateLimitEarlyStops,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[story-media-collector] fatal', { job_id: jobLog?.id ?? null, error: message }, err)
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'hourly_story_media_collector',
      processed: 0,
      errorCount: 1,
      errors: [{ error: message }],
      executedAt: startedAt,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}
