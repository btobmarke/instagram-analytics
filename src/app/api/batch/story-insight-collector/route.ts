export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { closeStaleRunningBatchLogs } from '@/lib/batch/close-stale-running-batch-logs'
import {
  runStoryInsightCollectorForAccounts,
  type StoryInsightCollectorAccountRow,
} from '@/lib/batch/jobs/story-insight-collector-batch'

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
    let acctQ = admin
      .from('ig_accounts')
      .select('id, platform_account_id, api_base_url, api_version, service_id')
      .eq('status', 'active')
      .not('service_id', 'is', null)
    if (accountIdFilter) acctQ = acctQ.eq('id', accountIdFilter)
    const { data: accounts, error: accountsError } = await acctQ

    console.info('[story-insight-collector] accounts found', {
      count: accounts?.length ?? 0,
      error: accountsError?.message ?? null,
    })

    if (accountsError) {
      throw new Error(accountsError.message)
    }

    const r = await runStoryInsightCollectorForAccounts(
      admin,
      (accounts ?? []) as StoryInsightCollectorAccountRow[]
    )
    totalProcessed = r.totalProcessed
    totalFailed = r.totalFailed
    const snapshotAtIso = r.snapshotAtIso

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

export async function GET(request: Request) {
  return POST(request)
}
