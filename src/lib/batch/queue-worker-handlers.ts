import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchJobQueueRow } from '@/lib/batch/queue-types'
import { completeBatchJob, deadLetterBatchJob, failBatchJob } from '@/lib/batch/batch-queue'
import {
  DEFAULT_WEATHER_OPTIONS,
  syncWeatherForProject,
  type WeatherSyncOptions,
} from '@/lib/batch/jobs/weather-sync-project'

type HandlerResult = { ok: true } | { ok: false; error: string; permanent?: boolean }

function parseWeatherPayload(payload: Record<string, unknown>): WeatherSyncOptions {
  const past = Number(payload.past_days ?? DEFAULT_WEATHER_OPTIONS.pastDays)
  const forecast = Number(payload.forecast_days ?? DEFAULT_WEATHER_OPTIONS.forecastDays)
  return {
    pastDays: Math.min(92, Math.max(0, Number.isFinite(past) ? past : DEFAULT_WEATHER_OPTIONS.pastDays)),
    forecastDays: Math.min(
      16,
      Math.max(1, Number.isFinite(forecast) ? forecast : DEFAULT_WEATHER_OPTIONS.forecastDays)
    ),
  }
}

/**
 * 1 件のキュー行を処理。batch_job_logs に project スコープで記録。
 */
export async function processBatchQueueRow(
  admin: SupabaseClient,
  row: BatchJobQueueRow
): Promise<HandlerResult> {
  if (row.job_name === 'weather_sync') {
    return processWeatherSyncRow(admin, row)
  }
  await deadLetterBatchJob(admin, row.id, `Unknown job_name: ${row.job_name}`)
  return { ok: false, error: `Unknown job_name: ${row.job_name}`, permanent: true }
}

async function processWeatherSyncRow(
  admin: SupabaseClient,
  row: BatchJobQueueRow
): Promise<HandlerResult> {
  if (!row.project_id) {
    await deadLetterBatchJob(admin, row.id, 'weather_sync requires project_id')
    return { ok: false, error: 'missing project_id', permanent: true }
  }

  const options = parseWeatherPayload(row.payload ?? {})

  const { data: project, error: pErr } = await admin
    .from('projects')
    .select('id, project_name, latitude, longitude, is_active')
    .eq('id', row.project_id)
    .maybeSingle()

  if (pErr || !project) {
    await deadLetterBatchJob(admin, row.id, pErr?.message ?? 'project not found')
    return { ok: false, error: 'project not found', permanent: true }
  }

  if (!project.is_active) {
    await deadLetterBatchJob(admin, row.id, 'project inactive')
    return { ok: false, error: 'project inactive', permanent: true }
  }

  if (project.latitude == null || project.longitude == null) {
    await deadLetterBatchJob(admin, row.id, 'no coordinates')
    return { ok: false, error: 'no coordinates', permanent: true }
  }

  const startedAt = new Date().toISOString()
  const { data: logRow } = await admin
    .from('batch_job_logs')
    .insert({
      job_name: 'weather_sync',
      project_id: row.project_id,
      status: 'running',
      started_at: startedAt,
      trigger_source: 'queue_worker',
      correlation_id: row.correlation_id,
      idempotency_key: row.idempotency_key,
      job_metadata: { queue_job_id: row.id },
    })
    .select('id')
    .single()

  const logId = logRow?.id as string | undefined

  try {
    await syncWeatherForProject(admin, project, options)
    if (logId) {
      await admin
        .from('batch_job_logs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(startedAt).getTime(),
          records_processed: 1,
          records_failed: 0,
        })
        .eq('id', logId)
    }
    await completeBatchJob(admin, row.id)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (logId) {
      await admin
        .from('batch_job_logs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(startedAt).getTime(),
          records_processed: 0,
          records_failed: 1,
          error_message: msg,
        })
        .eq('id', logId)
    }
    await failBatchJob(admin, row.id, msg, { requeueDelayMs: 120_000 })
    return { ok: false, error: msg }
  }
}
