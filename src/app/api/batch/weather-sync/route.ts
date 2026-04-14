export const dynamic    = 'force-dynamic'
export const maxDuration = 300 // 5分（Vercel Pro 上限）

/**
 * GET/POST /api/batch/weather-sync
 *
 * 全プロジェクトの天気予報・過去天気を一括取得して
 * project_external_daily に UPSERT するバッチ。
 *
 * Open-Meteo Forecast API を使用するため、
 * - 直近数日（Archive API では取得できない期間）も更新
 * - 先7日間の天気予報も事前に保存
 * → ユーザーがサマリーを開いたときにゼロレイテンシで表示可能
 *
 * 実行タイミング: 12時間ごと（UTC 0:00 = JST 9:00, UTC 12:00 = JST 21:00）
 * vercel.json: { "path": "/api/batch/weather-sync", "schedule": "0 0,12 * * *" }
 *
 * クエリパラメータ（手動実行用）:
 *   past_days     過去取得日数（デフォルト: 5）
 *   forecast_days 未来取得日数（デフォルト: 7）
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient }  from '@/lib/supabase/admin'
import { getHolidayInfo }             from '@/lib/external/holidays'
import { fetchWeatherForecast }       from '@/lib/external/weather'

// GET /api/batch/weather-sync ← Vercel Cron
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    const qSecret    = new URL(request.url).searchParams.get('secret')
    const provided   = authHeader?.replace('Bearer ', '') ?? qSecret ?? ''
    if (provided !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  return runBatch(request)
}

// POST でも手動実行可
export async function POST(request: NextRequest) {
  return GET(request)
}

// ── バッチ本体 ───────────────────────────────────────────────────────────────

async function runBatch(request: NextRequest) {
  const admin     = createSupabaseAdminClient()
  const startedAt = new Date()

  const url          = new URL(request.url)
  const pastDays     = Math.min(92, Math.max(0, Number(url.searchParams.get('past_days')     ?? '5')))
  const forecastDays = Math.min(16, Math.max(1, Number(url.searchParams.get('forecast_days') ?? '7')))

  // batch_job_logs 開始記録
  const { data: jobLog } = await admin
    .from('batch_job_logs')
    .insert({
      job_name:   'weather_sync',
      status:     'running',
      started_at: startedAt.toISOString(),
    })
    .select('id')
    .single()
  const jobLogId = jobLog?.id

  let processed = 0
  let errors    = 0

  try {
    // lat/lng が設定されているプロジェクトを取得
    const { data: projects, error: projErr } = await admin
      .from('projects')
      .select('id, project_name, latitude, longitude')
      .eq('is_active', true)
      .not('latitude',  'is', null)
      .not('longitude', 'is', null)

    if (projErr || !projects) {
      throw new Error(`projects 取得失敗: ${projErr?.message}`)
    }

    if (projects.length === 0) {
      await finalizeJob(admin, jobLogId, 'success', startedAt, 0, 0, null)
      return NextResponse.json({
        success:      true,
        processed:    0,
        errors:       0,
        message:      '位置情報が設定されたプロジェクトなし',
        past_days:    pastDays,
        forecast_days: forecastDays,
      })
    }

    // 取得対象の日付リストを生成（祝日判定に使う）
    const today     = new Date(Date.now() + 9 * 3600000) // JST approximation
    const todayKey  = today.toISOString().slice(0, 10)
    const dateKeys: string[] = []
    for (let i = -pastDays; i < forecastDays; i++) {
      const d = new Date(`${todayKey}T12:00:00+09:00`)
      d.setDate(d.getDate() + i)
      dateKeys.push(d.toISOString().slice(0, 10))
    }

    for (const project of projects) {
      try {
        // Forecast API で過去 N 日 + 未来 N 日を一括取得
        const weatherMap = await fetchWeatherForecast({
          latitude:     Number(project.latitude),
          longitude:    Number(project.longitude),
          pastDays,
          forecastDays,
        })

        // UPSERT 行を組み立て（取得できた日付のみ）
        const upsertRows = dateKeys.map(date => {
          const holiday = getHolidayInfo(date)
          const weather = weatherMap[date]
          return {
            project_id:       project.id,
            date,
            is_holiday:       holiday.isHoliday,
            holiday_name:     holiday.name ?? null,
            temperature_max:  weather?.temperature_max  ?? null,
            temperature_min:  weather?.temperature_min  ?? null,
            precipitation_mm: weather?.precipitation_mm ?? null,
            weather_code:     weather?.weather_code     ?? null,
            weather_desc:     weather?.weather_desc     ?? null,
            updated_at:       new Date().toISOString(),
          }
        })

        const { error: upsertErr } = await admin
          .from('project_external_daily')
          .upsert(upsertRows, { onConflict: 'project_id,date' })

        if (upsertErr) {
          console.error(`[weather-sync] upsert error project=${project.id}:`, upsertErr)
          errors++
        } else {
          console.log(`[weather-sync] project=${project.id} (${project.project_name}) upserted ${upsertRows.length} rows`)
          processed++
        }
      } catch (e) {
        console.error(`[weather-sync] project=${project.id} error:`, e)
        errors++
      }
    }

    const finalStatus = errors === 0 ? 'success' : processed > 0 ? 'partial' : 'failed'
    await finalizeJob(admin, jobLogId, finalStatus, startedAt, processed, errors, null)

    return NextResponse.json({
      success:      true,
      processed,
      errors,
      status:       finalStatus,
      past_days:    pastDays,
      forecast_days: forecastDays,
      dates_per_project: dateKeys.length,
      durationMs:   Date.now() - startedAt.getTime(),
    })
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr)
    console.error('[weather-sync] fatal error:', fatalErr)
    await finalizeJob(admin, jobLogId, 'failed', startedAt, processed, errors, msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

async function finalizeJob(
  admin:     ReturnType<typeof createSupabaseAdminClient>,
  jobLogId:  string | null | undefined,
  status:    string,
  startedAt: Date,
  processed: number,
  errors:    number,
  errorMsg:  string | null,
) {
  if (!jobLogId) return
  await admin
    .from('batch_job_logs')
    .update({
      status,
      finished_at:       new Date().toISOString(),
      duration_ms:       Date.now() - startedAt.getTime(),
      records_processed: processed,
      error_message:     errorMsg ?? (errors > 0 ? `${errors} 件のプロジェクトでエラー` : null),
    })
    .eq('id', jobLogId)
}
