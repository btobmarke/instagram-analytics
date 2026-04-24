export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { closeStaleRunningBatchLogs } from '@/lib/batch/close-stale-running-batch-logs'
import {
  runInsightCollectorForAccounts,
  type InsightCollectorAccountRow,
} from '@/lib/batch/jobs/insight-collector-batch'

export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const accountIdFilter = typeof body.account_id === 'string' ? body.account_id : undefined

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()

  await closeStaleRunningBatchLogs(admin, ['hourly_media_insight_collector'])

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'hourly_media_insight_collector',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  console.info('[insight-collector] start', { job_id: jobLog?.id ?? null })

  try {
    let acctQ = admin
      .from('ig_accounts')
      .select('id, platform_account_id, api_base_url, api_version, service_id')
      .eq('status', 'active')
      .not('service_id', 'is', null)
    if (accountIdFilter) acctQ = acctQ.eq('id', accountIdFilter)
    const { data: accounts, error: accountsError } = await acctQ

    console.info('[insight-collector] accounts found', {
      count: accounts?.length ?? 0,
      error: accountsError?.message ?? null,
    })

    if (accountsError) {
      throw new Error(accountsError.message)
    }

    const { totalProcessed, totalFailed, acctInsightTotal } = await runInsightCollectorForAccounts(
      admin,
      (accounts ?? []) as InsightCollectorAccountRow[]
    )

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

export async function GET(request: Request) {
  return POST(request)
}
