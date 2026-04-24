import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/utils/crypto'
import { throwOnDbError } from '@/lib/utils/supabase-assert'
import {
  parseServiceAccount,
  getAccessToken,
  fetchDailySummary,
  fetchPageMetrics,
  fetchTrafficSources,
  fetchEventMetrics,
  fetchDeviceMetrics,
  fetchGeoMetrics,
} from '@/lib/ga4/client'

function num(v: string | undefined): number {
  const n = parseFloat(v ?? '0')
  return isNaN(n) ? 0 : n
}

function intMetric(v: string | undefined): number {
  return Math.round(num(v))
}

export type Ga4IntegrationRow = {
  id: string
  service_id: string
  external_project_id: string | null
  encrypted_credential: string | null
  status: string
}

export type Ga4SyncOneResult = {
  serviceId: string
  propertyId: string
  date: string
  status: 'ok' | 'error'
  error?: string
  steps?: string[]
}

/**
 * 1 サービス分の GA4 同期（external_fetch_logs 含む）。キュー・HTTP から再利用。
 */
export async function syncGa4OneService(
  supabase: SupabaseClient,
  integ: Ga4IntegrationRow,
  targetDate: string
): Promise<Ga4SyncOneResult> {
  const propertyId = integ.external_project_id ?? ''
  const steps: string[] = []
  const logCtx = { serviceId: integ.service_id, propertyId, date: targetDate }

  throwOnDbError(
    'external_fetch_logs insert',
    await supabase.from('external_fetch_logs').insert({
      service_id: integ.service_id,
      integration_type: 'GA4',
      fetch_target_date: targetDate,
      fetch_status: 'STARTED',
      response_summary: null,
      started_at: new Date().toISOString(),
    })
  )

  try {
    if (!propertyId) throw new Error('GA4 プロパティ ID が未設定です')
    if (!integ.encrypted_credential) throw new Error('サービスアカウント JSON が未設定です')

    const saJson = decrypt(integ.encrypted_credential)
    const sa = parseServiceAccount(saJson)
    const accessToken = await getAccessToken(sa)
    steps.push('auth_ok')

    const summaryRows = await fetchDailySummary(propertyId, accessToken, targetDate)
    if (!summaryRows.length) {
      console.warn('[ga4-collector] fetchDailySummary returned 0 rows', logCtx)
    }
    const s = summaryRows[0]
    if (s) {
      const totalUsers = num(s.metrics[1])
      const newUsers = num(s.metrics[2])
      const returningUsers = Math.max(0, Math.round(totalUsers - newUsers))
      throwOnDbError(
        'ga4_daily_metrics upsert',
        await supabase.from('ga4_daily_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          sessions: num(s.metrics[0]),
          total_users: totalUsers,
          new_users: newUsers,
          returning_users: returningUsers,
          engaged_sessions: num(s.metrics[3]),
          engagement_rate: num(s.metrics[4]),
          bounce_rate: num(s.metrics[5]),
          avg_session_duration_sec: num(s.metrics[6]),
          sessions_per_user: num(s.metrics[7]),
          screen_page_views: num(s.metrics[8]),
          views_per_session: num(s.metrics[9]),
          conversions: num(s.metrics[10]),
          total_revenue: num(s.metrics[11]),
        }, { onConflict: 'service_id,report_date' })
      )
      steps.push('daily_summary_ok')
    }

    const pageRows = await fetchPageMetrics(propertyId, accessToken, targetDate)
    for (const row of pageRows) {
      throwOnDbError(
        'ga4_page_metrics upsert',
        await supabase.from('ga4_page_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          page_path: row.dims[0],
          page_title: row.dims[1] || null,
          screen_page_views: intMetric(row.metrics[0]),
          total_users: intMetric(row.metrics[1]),
          sessions: intMetric(row.metrics[2]),
          engaged_sessions: intMetric(row.metrics[3]),
          avg_time_on_page_sec: num(row.metrics[4]),
          bounce_rate: num(row.metrics[5]),
          entrances: intMetric(row.metrics[6]),
          exits: intMetric(row.metrics[7]),
          conversions: intMetric(row.metrics[8]),
        }, { onConflict: 'service_id,report_date,page_path' })
      )
    }
    steps.push(`pages_ok(${pageRows.length})`)

    const trafficRows = await fetchTrafficSources(propertyId, accessToken, targetDate)
    for (const row of trafficRows) {
      throwOnDbError(
        'ga4_traffic_sources upsert',
        await supabase.from('ga4_traffic_sources').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          session_source: row.dims[0],
          session_medium: row.dims[1],
          session_campaign: row.dims[2] || '(not set)',
          sessions: num(row.metrics[0]),
          total_users: num(row.metrics[1]),
          new_users: num(row.metrics[2]),
          engaged_sessions: num(row.metrics[3]),
          conversions: num(row.metrics[4]),
          total_revenue: num(row.metrics[5]),
        }, { onConflict: 'service_id,report_date,session_source,session_medium,session_campaign' })
      )
    }
    steps.push(`traffic_ok(${trafficRows.length})`)

    const eventRows = await fetchEventMetrics(propertyId, accessToken, targetDate)
    for (const row of eventRows) {
      throwOnDbError(
        'ga4_event_metrics upsert',
        await supabase.from('ga4_event_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          event_name: row.dims[0],
          event_count: num(row.metrics[0]),
          total_users: num(row.metrics[1]),
          conversions: num(row.metrics[2]),
          event_value: num(row.metrics[3]),
        }, { onConflict: 'service_id,report_date,event_name' })
      )
    }
    steps.push(`events_ok(${eventRows.length})`)

    const deviceRows = await fetchDeviceMetrics(propertyId, accessToken, targetDate)
    for (const row of deviceRows) {
      throwOnDbError(
        'ga4_device_metrics upsert',
        await supabase.from('ga4_device_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          device_category: row.dims[0],
          operating_system: row.dims[1] || '(not set)',
          browser: row.dims[2] || '(not set)',
          sessions: num(row.metrics[0]),
          total_users: num(row.metrics[1]),
          new_users: num(row.metrics[2]),
          conversions: num(row.metrics[3]),
        }, { onConflict: 'service_id,report_date,device_category,operating_system,browser' })
      )
    }
    steps.push(`device_ok(${deviceRows.length})`)

    const geoRows = await fetchGeoMetrics(propertyId, accessToken, targetDate)
    for (const row of geoRows) {
      throwOnDbError(
        'ga4_geo_metrics upsert',
        await supabase.from('ga4_geo_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          country: row.dims[0],
          region: row.dims[1] || '(not set)',
          city: row.dims[2] || '(not set)',
          sessions: num(row.metrics[0]),
          total_users: num(row.metrics[1]),
          new_users: num(row.metrics[2]),
          conversions: num(row.metrics[3]),
        }, { onConflict: 'service_id,report_date,country,region,city' })
      )
    }
    steps.push(`geo_ok(${geoRows.length})`)

    throwOnDbError(
      'service_integrations update',
      await supabase
        .from('service_integrations')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', integ.id)
    )

    throwOnDbError(
      'external_fetch_logs update SUCCESS',
      await supabase
        .from('external_fetch_logs')
        .update({
          fetch_status: 'SUCCESS',
          response_summary: steps.join(', '),
          finished_at: new Date().toISOString(),
        })
        .eq('service_id', integ.service_id)
        .eq('integration_type', 'GA4')
        .eq('fetch_target_date', targetDate)
        .eq('fetch_status', 'STARTED')
    )

    return { serviceId: integ.service_id, propertyId, date: targetDate, status: 'ok', steps }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ga4-collector] error', { ...logCtx, message })

    const failLog = await supabase
      .from('external_fetch_logs')
      .update({
        fetch_status: 'FAILED',
        response_summary: message,
        finished_at: new Date().toISOString(),
      })
      .eq('service_id', integ.service_id)
      .eq('integration_type', 'GA4')
      .eq('fetch_target_date', targetDate)
      .eq('fetch_status', 'STARTED')
    if (failLog.error) {
      console.error('[ga4-collector] external_fetch_logs FAILED update failed', failLog.error)
    }

    return { serviceId: integ.service_id, propertyId, date: targetDate, status: 'error', error: message }
  }
}
