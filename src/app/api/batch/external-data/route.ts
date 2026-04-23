export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET/POST /api/batch/external-data
 *
 * 全プロジェクトの「昨日分」祝日・天気データを取得して
 * project_external_daily に UPSERT するバッチ。
 *
 * 実行タイミング: JST 02:00 (UTC 17:00 前日) に毎日実行
 * vercel.json: { "path": "/api/batch/external-data", "schedule": "0 17 * * *" }
 *
 * 天気 API: Open-Meteo（APIキー不要）
 *   - latitude / longitude が設定されているプロジェクトのみ天気取得
 *   - 設定がないプロジェクトは祝日のみ保存
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { getHolidayInfo } from '@/lib/external/holidays'
import { fetchWeather } from '@/lib/external/weather'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

/** JST の昨日 YYYY-MM-DD */
function jstYesterday(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  jst.setUTCDate(jst.getUTCDate() - 1)
  return jst.toISOString().slice(0, 10)
}

// GET /api/batch/external-data ← Vercel Cron
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
  return runBatch(request)
}

// POST でも手動実行可
export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('external-data', request)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runBatch(request)
}

// ── バッチ本体 ───────────────────────────────────────────────────────────────

async function runBatch(_request: NextRequest) {
  const admin    = createSupabaseAdminClient()
  const startedAt = new Date()

  // クエリパラメータで対象日を上書き可能（手動実行・再処理用）
  // 例: /api/batch/external-data?date=2025-04-01
  const url         = new URL(_request.url)
  const targetDate  = url.searchParams.get('date') ?? jstYesterday()
  const projectFilter = url.searchParams.get('project')

  // batch_job_logs 開始記録
  const { data: jobLog } = await admin
    .from('batch_job_logs')
    .insert({
      job_name:   'external_data',
      status:     'running',
      started_at: startedAt.toISOString(),
    })
    .select('id')
    .single()
  const jobLogId = jobLog?.id

  let processed = 0
  let errors    = 0

  try {
    // 全プロジェクトを取得（latitude/longitude の有無に関わらず全件）
    let projQ = admin
      .from('projects')
      .select('id, project_name, latitude, longitude')
      .eq('is_active', true)
    if (projectFilter) projQ = projQ.eq('id', projectFilter)
    const { data: projects, error: projErr } = await projQ

    if (projErr || !projects) {
      throw new Error(`projects 取得失敗: ${projErr?.message}`)
    }

    // 祝日情報は全プロジェクト共通
    const holidayInfo = getHolidayInfo(targetDate)

    for (const project of projects) {
      try {
        // 天気情報（lat/lng が設定されているプロジェクトのみ）
        let weatherData = {
          temperature_max:  null as number | null,
          temperature_min:  null as number | null,
          precipitation_mm: null as number | null,
          weather_code:     null as number | null,
          weather_desc:     null as string | null,
        }

        if (project.latitude != null && project.longitude != null) {
          const w = await fetchWeather({
            latitude:  Number(project.latitude),
            longitude: Number(project.longitude),
            date:      targetDate,
          })
          weatherData = w
        }

        // UPSERT
        const { error: upsertErr } = await admin
          .from('project_external_daily')
          .upsert(
            {
              project_id:       project.id,
              date:             targetDate,
              is_holiday:       holidayInfo.isHoliday,
              holiday_name:     holidayInfo.name ?? null,
              temperature_max:  weatherData.temperature_max,
              temperature_min:  weatherData.temperature_min,
              precipitation_mm: weatherData.precipitation_mm,
              weather_code:     weatherData.weather_code,
              weather_desc:     weatherData.weather_desc,
              updated_at:       new Date().toISOString(),
            },
            { onConflict: 'project_id,date' },
          )

        if (upsertErr) {
          console.error(`[external-data] upsert error project=${project.id}:`, upsertErr)
          errors++
        } else {
          processed++
        }
      } catch (e) {
        console.error(`[external-data] project=${project.id} error:`, e)
        errors++
      }
    }

    const finishedAt   = new Date()
    const durationMs   = finishedAt.getTime() - startedAt.getTime()
    const finalStatus  = errors === 0 ? 'success' : processed > 0 ? 'partial' : 'failed'

    // batch_job_logs 完了記録
    if (jobLogId) {
      await admin
        .from('batch_job_logs')
        .update({
          status:            finalStatus,
          finished_at:       finishedAt.toISOString(),
          duration_ms:       durationMs,
          records_processed: processed,
          error_message:     errors > 0 ? `${errors} 件のプロジェクトでエラー` : null,
        })
        .eq('id', jobLogId)
    }

    if (finalStatus === 'success') {
      await notifyBatchSuccess({
        jobName: 'external_data',
        processed,
        executedAt: startedAt,
        lines: [`対象日: ${targetDate}`],
      })
    } else {
      await notifyBatchError({
        jobName: 'external_data',
        processed,
        errorCount: errors,
        errors: [{ error: `${errors} 件のプロジェクトでエラー` }],
        executedAt: startedAt,
      })
    }

    return NextResponse.json({
      success: true,
      date:       targetDate,
      processed,
      errors,
      status:     finalStatus,
      durationMs,
    })
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr)
    console.error('[external-data] fatal error:', fatalErr)

    if (jobLogId) {
      await admin
        .from('batch_job_logs')
        .update({
          status:      'failed',
          finished_at: new Date().toISOString(),
          error_message: msg,
        })
        .eq('id', jobLogId)
    }

    await notifyBatchError({
      jobName: 'external_data',
      processed: 0,
      errorCount: 1,
      errors: [{ error: msg }],
      executedAt: startedAt,
    })

    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
