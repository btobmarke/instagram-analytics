import type { SupabaseClient } from '@supabase/supabase-js'
import { getHolidayInfo } from '@/lib/external/holidays'
import { fetchWeather } from '@/lib/external/weather'

export type ExternalDataProjectPayload = {
  project_id: string
  target_date: string
}

/**
 * 1 プロジェクト分の external-data（祝日＋任意で天気）を UPSERT。
 * キューワーカー用。batch_job_logs は呼び出し側で持たない。
 */
export async function runExternalDataForProject(
  admin: SupabaseClient,
  payload: ExternalDataProjectPayload
): Promise<void> {
  const { project_id, target_date: targetDate } = payload

  const { data: project, error } = await admin
    .from('projects')
    .select('id, project_name, latitude, longitude')
    .eq('id', project_id)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!project) throw new Error('project not found or inactive')

  const holidayInfo = getHolidayInfo(targetDate)
  let weatherData = {
    temperature_max: null as number | null,
    temperature_min: null as number | null,
    precipitation_mm: null as number | null,
    weather_code: null as number | null,
    weather_desc: null as string | null,
  }

  if (project.latitude != null && project.longitude != null) {
    weatherData = await fetchWeather({
      latitude: Number(project.latitude),
      longitude: Number(project.longitude),
      date: targetDate,
    })
  }

  const { error: upsertErr } = await admin.from('project_external_daily').upsert(
    {
      project_id: project.id,
      date: targetDate,
      is_holiday: holidayInfo.isHoliday,
      holiday_name: holidayInfo.name ?? null,
      temperature_max: weatherData.temperature_max,
      temperature_min: weatherData.temperature_min,
      precipitation_mm: weatherData.precipitation_mm,
      weather_code: weatherData.weather_code,
      weather_desc: weatherData.weather_desc,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,date' }
  )

  if (upsertErr) throw new Error(upsertErr.message)
}
