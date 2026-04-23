export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { dequeueBatchJobs } from '@/lib/batch/batch-queue'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { processBatchQueueRow } from '@/lib/batch/queue-worker-handlers'

/**
 * POST /api/internal/batch-queue-worker
 * Cron または手動で叩き、`batch_job_queue` からジョブを dequeue して処理する。
 * Authorization: Bearer {CRON_SECRET | BATCH_SECRET | BATCH_WORKER_SECRET}
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const workerSecret = process.env.BATCH_WORKER_SECRET
  const authOk =
    validateBatchRequest(request) ||
    (workerSecret
      ? request.headers.get('authorization') === `Bearer ${workerSecret}`
      : false)

  if (!authOk) {
    logBatchAuthFailure('internal/batch-queue-worker', request)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(25, Math.max(1, parseInt(searchParams.get('limit') ?? '8', 10)))

  const admin = createSupabaseAdminClient()
  const { rows, error } = await dequeueBatchJobs(admin, limit)

  if (error) {
    console.error('[batch-queue-worker] dequeue failed', error)
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, jobs: [] })
  }

  const results: Array<{ queue_id: string; job_name: string; ok: boolean; error?: string }> = []

  for (const row of rows) {
    const r = await processBatchQueueRow(admin, row)
    results.push({
      queue_id: row.id,
      job_name: row.job_name,
      ok: r.ok,
      error: r.ok ? undefined : r.error,
    })
  }

  const allOk = results.every(x => x.ok)
  return NextResponse.json(
    {
      ok: allOk,
      processed: results.length,
      jobs: results,
    },
    { status: allOk ? 200 : 207 }
  )
}
