export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET/POST /api/batch/weather-sync
 *
 * 既定: 位置情報付き全プロジェクトを **キューに投入**（`batch_job_queue`）。実処理は
 * `POST /api/internal/batch-queue-worker`（Vercel Cron）が dequeue して実行。
 * 従来の一括インライン実行に戻す: `BATCH_QUEUE_DISABLED=true`
 *
 * クエリ: past_days, forecast_days（GET/POST 共通）
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import {
  buildWeatherDateKeys,
  loadActiveProjectsWithCoordinates,
  syncWeatherForProject,
} from '@/lib/batch/jobs/weather-sync-project'
import {
  enqueueAllWeatherSyncJobs,
  isBatchQueueDisabled,
  parseWeatherOptionsFromUrl,
} from '@/lib/batch/queue-weather'

export async function GET(request: NextRequest) {
  if (validateBatchRequest(request)) {
    return runBatch(request)
  }
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    const qSecret = new URL(request.url).searchParams.get('secret')
    const provided = authHeader?.replace(/^Bearer\s+/i, '')?.trim() ?? qSecret ?? ''
    if (provided !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  // CRON_SECRET 未設定時は従来どおり GET を通す（ローカル検証用）
  return runBatch(request)
}

export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('weather-sync', request)
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'バッチ認証に失敗しました' } },
      { status: 401 }
    )
  }
  return runBatch(request)
}

async function runBatch(request: NextRequest) {
  const admin = createSupabaseAdminClient()
  const url = new URL(request.url)
  const options = parseWeatherOptionsFromUrl(url)

  if (!isBatchQueueDisabled()) {
    try {
      const q = await enqueueAllWeatherSyncJobs(admin, options, 'cron')
      return NextResponse.json({
        success: true,
        mode: 'queue',
        correlation_id: q.correlation_id,
        enqueued: q.enqueued,
        skipped: q.skipped,
        failed: q.failed,
        project_count: q.project_ids.length,
        past_days: options.pastDays,
        forecast_days: options.forecastDays,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[weather-sync] enqueue failed', e)
      return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
  }

  return runBatchInline(admin, request, options)
}

/** BATCH_QUEUE_DISABLED=true のときのみ（従来の一括処理） */
async function runBatchInline(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  request: NextRequest,
  options: { pastDays: number; forecastDays: number }
) {
  const startedAt = new Date()
  const { pastDays, forecastDays } = options

  const { data: jobLog } = await admin
    .from('batch_job_logs')
    .insert({
      job_name: 'weather_sync',
      status: 'running',
      started_at: startedAt.toISOString(),
      trigger_source: 'cron',
    })
    .select('id')
    .single()
  const jobLogId = jobLog?.id

  let processed = 0
  let errors = 0

  try {
    const { projects, error: projErr } = await loadActiveProjectsWithCoordinates(admin)

    if (projErr || !projects) {
      throw new Error(`projects 取得失敗: ${projErr}`)
    }

    if (projects.length === 0) {
      await finalizeJob(admin, jobLogId, 'success', startedAt, 0, 0, null)
      return NextResponse.json({
        success: true,
        mode: 'inline',
        processed: 0,
        errors: 0,
        message: '位置情報が設定されたプロジェクトなし',
        past_days: pastDays,
        forecast_days: forecastDays,
      })
    }

    const dateKeys = buildWeatherDateKeys(pastDays, forecastDays)

    for (const project of projects) {
      try {
        await syncWeatherForProject(admin, project, { pastDays, forecastDays })
        console.log(
          `[weather-sync] project=${project.id} (${project.project_name}) upserted ${dateKeys.length} date keys`
        )
        processed++
      } catch (e) {
        console.error(`[weather-sync] project=${project.id} error:`, e)
        errors++
      }
    }

    const finalStatus = errors === 0 ? 'success' : processed > 0 ? 'partial' : 'failed'
    await finalizeJob(admin, jobLogId, finalStatus, startedAt, processed, errors, null)

    if (finalStatus === 'success') {
      await notifyBatchSuccess({
        jobName: 'weather_sync',
        processed,
        executedAt: startedAt,
        lines: [`past_days: ${pastDays}`, `forecast_days: ${forecastDays}`, 'mode: inline'],
      })
    } else {
      await notifyBatchError({
        jobName: 'weather_sync',
        processed,
        errorCount: errors,
        errors: [{ error: `${errors} 件のプロジェクトでエラー` }],
        executedAt: startedAt,
      })
    }

    return NextResponse.json({
      success: true,
      mode: 'inline',
      processed,
      errors,
      status: finalStatus,
      past_days: pastDays,
      forecast_days: forecastDays,
      dates_per_project: dateKeys.length,
      durationMs: Date.now() - startedAt.getTime(),
    })
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr)
    console.error('[weather-sync] fatal error:', fatalErr)
    await finalizeJob(admin, jobLogId, 'failed', startedAt, processed, errors, msg)
    await notifyBatchError({
      jobName: 'weather_sync',
      processed: 0,
      errorCount: 1,
      errors: [{ error: msg }],
      executedAt: startedAt,
    })
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

async function finalizeJob(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobLogId: string | null | undefined,
  status: string,
  startedAt: Date,
  processed: number,
  errors: number,
  errorMsg: string | null
) {
  if (!jobLogId) return
  await admin
    .from('batch_job_logs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
      records_processed: processed,
      error_message: errorMsg ?? (errors > 0 ? `${errors} 件のプロジェクトでエラー` : null),
    })
    .eq('id', jobLogId)
}
