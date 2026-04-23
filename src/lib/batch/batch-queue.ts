import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchJobQueueRow } from '@/lib/batch/queue-types'

export type EnqueueInput = {
  job_name: string
  project_id?: string | null
  service_id?: string | null
  account_id?: string | null
  payload?: Record<string, unknown>
  idempotency_key: string
  correlation_id?: string | null
  trigger_source: 'cron' | 'manual' | 'queue_worker' | 'api' | 'internal'
  max_attempts?: number
  run_after?: Date
}

/**
 * キューに投入。同一 idempotency_key の pending/processing があればスキップ（DB unique）。
 * @returns inserted row id or null if conflict / skip
 */
export async function enqueueBatchJob(
  admin: SupabaseClient,
  input: EnqueueInput
): Promise<{ id: string | null; skipped: boolean; error?: string }> {
  const row = {
    job_name: input.job_name,
    project_id: input.project_id ?? null,
    service_id: input.service_id ?? null,
    account_id: input.account_id ?? null,
    payload: input.payload ?? {},
    idempotency_key: input.idempotency_key,
    correlation_id: input.correlation_id ?? null,
    trigger_source: input.trigger_source,
    max_attempts: input.max_attempts ?? 3,
    run_after: (input.run_after ?? new Date()).toISOString(),
    status: 'pending' as const,
  }

  const { data, error } = await admin.from('batch_job_queue').insert(row).select('id').maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return { id: null, skipped: true }
    }
    return { id: null, skipped: false, error: error.message }
  }
  return { id: data?.id ?? null, skipped: false }
}

export async function dequeueBatchJobs(
  admin: SupabaseClient,
  limit: number = 5
): Promise<{ rows: BatchJobQueueRow[]; error?: string }> {
  const { data, error } = await admin.rpc('dequeue_batch_jobs', { p_limit: limit })

  if (error) {
    return { rows: [], error: error.message }
  }
  return { rows: (data ?? []) as BatchJobQueueRow[] }
}

export async function completeBatchJob(admin: SupabaseClient, id: string): Promise<void> {
  await admin
    .from('batch_job_queue')
    .update({
      status: 'completed',
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
}

/** 再試行しない終了（例: プロジェクト削除済み） */
export async function deadLetterBatchJob(admin: SupabaseClient, id: string, message: string): Promise<void> {
  await admin
    .from('batch_job_queue')
    .update({
      status: 'dead',
      last_error: message,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
}

export async function failBatchJob(
  admin: SupabaseClient,
  id: string,
  message: string,
  opts: { requeueDelayMs?: number; maxAttempts?: number } = {}
): Promise<void> {
  const { data: row } = await admin.from('batch_job_queue').select('attempts, max_attempts').eq('id', id).single()

  const attempts = row?.attempts ?? 0
  const maxAttempts = row?.max_attempts ?? opts.maxAttempts ?? 3

  if (attempts >= maxAttempts) {
    await admin
      .from('batch_job_queue')
      .update({
        status: 'dead',
        last_error: message,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    return
  }

  const runAfter = new Date(Date.now() + (opts.requeueDelayMs ?? 60_000))
  await admin
    .from('batch_job_queue')
    .update({
      status: 'pending',
      last_error: message,
      locked_at: null,
      locked_by: null,
      run_after: runAfter.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
}
