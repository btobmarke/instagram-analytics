import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchJobQueueRow } from '@/lib/batch/queue-types'
import { completeBatchJob, failBatchJob } from '@/lib/batch/batch-queue'
import { processWeatherSyncRow } from '@/lib/batch/queue-weather-sync-row'
import { dispatchQueueJobInProcess } from '@/lib/batch/queue-internal-dispatch'

type HandlerResult = { ok: true } | { ok: false; error: string; permanent?: boolean }

/**
 * 1 件のキュー行を処理（Vercel への自己 `fetch` / `batch_proxy` は使わない）。
 */
export async function processBatchQueueRow(
  admin: SupabaseClient,
  row: BatchJobQueueRow
): Promise<HandlerResult> {
  if (row.job_name === 'weather_sync') {
    const r = await processWeatherSyncRow(admin, row)
    if (r.ok) {
      await completeBatchJob(admin, row.id)
    }
    return r
  }

  try {
    await dispatchQueueJobInProcess(admin, row.job_name, (row.payload ?? {}) as Record<string, unknown>)
    await completeBatchJob(admin, row.id)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await failBatchJob(admin, row.id, msg, { requeueDelayMs: 120_000 })
    return { ok: false, error: msg }
  }
}
