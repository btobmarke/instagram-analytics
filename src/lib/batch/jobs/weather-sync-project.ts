import type { SupabaseClient } from '@supabase/supabase-js'
import { getHolidayInfo } from '@/lib/external/holidays'
import { fetchWeatherForecast } from '@/lib/external/weather'

export type WeatherSyncProjectRow = {
  id: string
  project_name: string | null
  latitude: number | string | null
  longitude: number | string | null
}

export type WeatherSyncOptions = {
  pastDays: number
  forecastDays: number
}

export const DEFAULT_WEATHER_OPTIONS: WeatherSyncOptions = {
  pastDays: 5,
  forecastDays: 7,
}

/** JST 基準の日付キー列（既存バッチと同じ） */
export function buildWeatherDateKeys(pastDays: number, forecastDays: number): string[] {
  const today = new Date(Date.now() + 9 * 3600000)
  const todayKey = today.toISOString().slice(0, 10)
  const dateKeys: string[] = []
  for (let i = -pastDays; i < forecastDays; i++) {
    const d = new Date(`${todayKey}T12:00:00+09:00`)
    d.setDate(d.getDate() + i)
    dateKeys.push(d.toISOString().slice(0, 10))
  }
  return dateKeys
}

/**
 * 1 プロジェクト分の天気同期。成功時は upsert 行数、失敗時は例外またはエラーメッセージ。
 */
export async function syncWeatherForProject(
  admin: SupabaseClient,
  project: WeatherSyncProjectRow,
  options: WeatherSyncOptions
): Promise<{ upsertedRows: number }> {
  const { pastDays, forecastDays } = options
  if (project.latitude == null || project.longitude == null) {
    throw new Error('latitude/longitude missing')
  }

  const dateKeys = buildWeatherDateKeys(pastDays, forecastDays)
  const weatherMap = await fetchWeatherForecast({
    latitude: Number(project.latitude),
    longitude: Number(project.longitude),
    pastDays,
    forecastDays,
  })

  const upsertRows = dateKeys.map(date => {
    const holiday = getHolidayInfo(date)
    const weather = weatherMap[date]
    return {
      project_id: project.id,
      date,
      is_holiday: holiday.isHoliday,
      holiday_name: holiday.name ?? null,
      temperature_max: weather?.temperature_max ?? null,
      temperature_min: weather?.temperature_min ?? null,
      precipitation_mm: weather?.precipitation_mm ?? null,
      weather_code: weather?.weather_code ?? null,
      weather_desc: weather?.weather_desc ?? null,
      updated_at: new Date().toISOString(),
    }
  })

  const { error: upsertErr } = await admin
    .from('project_external_daily')
    .upsert(upsertRows, { onConflict: 'project_id,date' })

  if (upsertErr) {
    throw new Error(upsertErr.message)
  }
  return { upsertedRows: upsertRows.length }
}

export async function loadActiveProjectsWithCoordinates(
  admin: SupabaseClient
): Promise<{ projects: WeatherSyncProjectRow[]; error: string | null }> {
  const { data: projects, error: projErr } = await admin
    .from('projects')
    .select('id, project_name, latitude, longitude')
    .eq('is_active', true)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)

  if (projErr) {
    return { projects: [], error: projErr.message }
  }
  return { projects: (projects ?? []) as WeatherSyncProjectRow[], error: null }
}
