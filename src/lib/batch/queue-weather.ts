import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueBatchJob } from '@/lib/batch/batch-queue'
import {
  DEFAULT_WEATHER_OPTIONS,
  loadActiveProjectsWithCoordinates,
  type WeatherSyncOptions,
} from '@/lib/batch/jobs/weather-sync-project'

export function isBatchQueueDisabled(): boolean {
  return process.env.BATCH_QUEUE_DISABLED === 'true'
}

export type EnqueueWeatherResult = {
  mode: 'queue'
  correlation_id: string
  enqueued: number
  skipped: number
  failed: number
  project_ids: string[]
}

/**
 * 天気同期を全対象プロジェクト分キューに載せる。
 */
export async function enqueueAllWeatherSyncJobs(
  admin: SupabaseClient,
  options: WeatherSyncOptions,
  triggerSource: 'cron' | 'manual' | 'api' | 'internal'
): Promise<EnqueueWeatherResult> {
  const { projects, error } = await loadActiveProjectsWithCoordinates(admin)
  if (error) {
    throw new Error(error)
  }

  const correlationId = randomUUID()
  const dayKey = new Date().toISOString().slice(0, 10)
  let enqueued = 0
  let skipped = 0
  let failed = 0
  const project_ids: string[] = []

  for (const p of projects) {
    const idempotencyKey = `weather_sync:${p.id}:${dayKey}`
    const res = await enqueueBatchJob(admin, {
      job_name: 'weather_sync',
      project_id: p.id,
      payload: {
        past_days: options.pastDays,
        forecast_days: options.forecastDays,
      },
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      trigger_source: triggerSource,
    })
    project_ids.push(p.id)
    if (res.skipped) skipped++
    else if (res.error) failed++
    else if (res.id) enqueued++
    else failed++
  }

  return {
    mode: 'queue',
    correlation_id: correlationId,
    enqueued,
    skipped,
    failed,
    project_ids,
  }
}

export function parseWeatherOptionsFromUrl(url: URL): WeatherSyncOptions {
  const pastDays = Math.min(
    92,
    Math.max(0, Number(url.searchParams.get('past_days') ?? String(DEFAULT_WEATHER_OPTIONS.pastDays)))
  )
  const forecastDays = Math.min(
    16,
    Math.max(1, Number(url.searchParams.get('forecast_days') ?? String(DEFAULT_WEATHER_OPTIONS.forecastDays)))
  )
  return { pastDays, forecastDays }
}
