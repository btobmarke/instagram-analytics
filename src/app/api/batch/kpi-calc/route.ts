export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { runKpiCalcForAccount } from '@/lib/batch/kpi-calc-one-account'

// POST /api/batch/kpi-calc — KPI計算バッチ
export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const accountIdFilter = typeof body.account_id === 'string' ? body.account_id : undefined

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()
  let totalProcessed = 0

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'kpi_calc_batch',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  try {
    let acctQ = admin.from('ig_accounts').select('id').eq('status', 'active')
    if (accountIdFilter) acctQ = acctQ.eq('id', accountIdFilter)
    const { data: accounts } = await acctQ
    const { data: kpiMasters } = await admin.from('kpi_master').select('*').eq('is_active', true)

    for (const account of (accounts ?? [])) {
      totalProcessed += await runKpiCalcForAccount(admin, account.id, (kpiMasters ?? []) as never[])
    }

    const duration = Date.now() - startedAt.getTime()
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'success',
        records_processed: totalProcessed,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      }).eq('id', jobLog.id)
    }

    await notifyBatchSuccess({
      jobName: 'kpi_calc_batch',
      processed: totalProcessed,
      executedAt: startedAt,
    })

    return NextResponse.json({ success: true, processed: totalProcessed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'kpi_calc_batch',
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
