/**
 * GET /api/projects/[projectId]/unified-summary/external
 *
 * 指定期間のプロジェクト外生変数（祝日・天気）を返す。
 * project_external_daily テーブルのキャッシュを使用。
 * キャッシュが存在しない日はオンデマンドで取得して保存する。
 *
 * Query params:
 *   from  YYYY-MM-DD（必須）
 *   to    YYYY-MM-DD（必須）
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getHolidayInfo } from '@/lib/external/holidays'
import { fetchWeatherBatch } from '@/lib/external/weather'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    )
  }

  const url  = new URL(req.url)
  const from = url.searchParams.get('from')
  const to   = url.searchParams.get('to')

  if (!from || !to || from > to) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'from・to（YYYY-MM-DD）が必要です' } },
      { status: 400 },
    )
  }

  // プロジェクトの位置情報を取得
  const { data: project } = await supabase
    .from('projects')
    .select('id, latitude, longitude')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND' } },
      { status: 404 },
    )
  }

  // キャッシュを取得
  const { data: cached } = await supabase
    .from('project_external_daily')
    .select('date, is_holiday, holiday_name, temperature_max, temperature_min, precipitation_mm, weather_code, weather_desc')
    .eq('project_id', projectId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })

  const cachedMap = new Map<string, Record<string, unknown>>()
  for (const row of cached ?? []) {
    cachedMap.set(String(row.date).slice(0, 10), row as Record<string, unknown>)
  }

  // キャッシュにない日を特定
  const allDates: string[] = []
  const cur = new Date(`${from}T12:00:00+09:00`)
  const end = new Date(`${to}T12:00:00+09:00`)
  while (cur <= end) {
    allDates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }

  const missingDates = allDates.filter(d => !cachedMap.has(d))

  // キャッシュにない日はオンデマンドで取得して保存
  if (missingDates.length > 0) {
    const admin = createSupabaseAdminClient()

    // 天気をまとめて取得（lat/lng あれば）
    const weatherMap: Record<string, Awaited<ReturnType<typeof fetchWeatherBatch>>[string]> = {}
    if (project.latitude != null && project.longitude != null) {
      const wMap = await fetchWeatherBatch({
        latitude:  Number(project.latitude),
        longitude: Number(project.longitude),
        dates:     missingDates,
      })
      Object.assign(weatherMap, wMap)
    }

    // UPSERT & キャッシュ更新
    const upsertRows = missingDates.map(date => {
      const holiday = getHolidayInfo(date)
      const weather = weatherMap[date]
      return {
        project_id:       projectId,
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

    if (!upsertErr) {
      // キャッシュマップに反映
      for (const row of upsertRows) {
        cachedMap.set(row.date, row as Record<string, unknown>)
      }
    } else {
      console.warn('[external] upsert error:', upsertErr)
      // upsert 失敗でもレスポンスは返す（計算値をそのまま使う）
      for (const row of upsertRows) {
        cachedMap.set(row.date, row as Record<string, unknown>)
      }
    }
  }

  // 全日付のデータをまとめてレスポンス
  const result: Record<string, {
    is_holiday:       boolean | null
    holiday_name:     string | null
    temperature_max:  number | null
    temperature_min:  number | null
    precipitation_mm: number | null
    weather_code:     number | null
    weather_desc:     string | null
  }> = {}

  for (const date of allDates) {
    const row = cachedMap.get(date)
    result[date] = {
      is_holiday:       (row?.is_holiday as boolean | null)       ?? null,
      holiday_name:     (row?.holiday_name as string | null)      ?? null,
      temperature_max:  (row?.temperature_max as number | null)   ?? null,
      temperature_min:  (row?.temperature_min as number | null)   ?? null,
      precipitation_mm: (row?.precipitation_mm as number | null)  ?? null,
      weather_code:     (row?.weather_code as number | null)      ?? null,
      weather_desc:     (row?.weather_desc as string | null)      ?? null,
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      hasWeather: project.latitude != null && project.longitude != null,
      dates:      result,
    },
  })
}
