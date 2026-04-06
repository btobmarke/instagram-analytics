export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/utils/crypto'
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

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function num(v: string | undefined): number {
  const n = parseFloat(v ?? '0')
  return isNaN(n) ? 0 : n
}

/**
 * POST /api/batch/ga4-collector
 *
 * GA4 データ収集バッチ。
 * service_integrations に integration_type='GA4' が登録されているサービスに対して
 * 前日（または指定日）の全データを取得し各テーブルに upsert する。
 *
 * Body (optional):
 *   { "date": "YYYY-MM-DD", "service_id": "uuid" }
 *
 * Authorization: Bearer {BATCH_SECRET}
 */
export async function POST(request: NextRequest) {
  // --- 認証 ---
  const authHeader = request.headers.get('authorization')
  const batchSecret = process.env.BATCH_SECRET
  if (!batchSecret || authHeader !== `Bearer ${batchSecret}`) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'バッチ認証に失敗しました' } },
      { status: 401 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const targetDate: string =
    body.date ??
    new Date(Date.now() - 86400000).toISOString().slice(0, 10) // 前日

  const supabase = createServiceRoleClient()
  const startedAt = new Date().toISOString()

  // --- GA4 連携設定を取得 ---
  let integQuery = supabase
    .from('service_integrations')
    .select('id, service_id, external_project_id, encrypted_credential, status')
    .eq('integration_type', 'GA4')
    .eq('status', 'active')

  if (body.service_id) {
    integQuery = integQuery.eq('service_id', body.service_id)
  }

  const { data: integrations, error: integError } = await integQuery

  if (integError) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: integError.message } },
      { status: 500 }
    )
  }

  const results: Array<{
    serviceId: string
    propertyId: string
    date: string
    status: 'ok' | 'error'
    error?: string
    steps?: string[]
  }> = []

  for (const integ of integrations ?? []) {
    const propertyId = integ.external_project_id ?? ''
    const steps: string[] = []
    const logCtx = { serviceId: integ.service_id, propertyId, date: targetDate }

    // fetch_log を started に記録
    await supabase.from('external_fetch_logs').insert({
      service_id: integ.service_id,
      integration_type: 'GA4',
      fetch_target_date: targetDate,
      fetch_status: 'STARTED',
      response_summary: null,
      started_at: new Date().toISOString(),
    })

    try {
      if (!propertyId) throw new Error('GA4 プロパティ ID が未設定です')
      if (!integ.encrypted_credential) throw new Error('サービスアカウント JSON が未設定です')

      // --- 認証 ---
      const saJson = decrypt(integ.encrypted_credential)
      const sa = parseServiceAccount(saJson)
      const accessToken = await getAccessToken(sa)
      steps.push('auth_ok')

      // =====================================================================
      // 1. 日次サマリー
      // =====================================================================
      const summaryRows = await fetchDailySummary(propertyId, accessToken, targetDate)
      const s = summaryRows[0]
      if (s) {
        await supabase.from('ga4_daily_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          sessions: num(s.metrics[0]),
          total_users: num(s.metrics[1]),
          new_users: num(s.metrics[2]),
          returning_users: num(s.metrics[3]),
          engaged_sessions: num(s.metrics[4]),
          engagement_rate: num(s.metrics[5]),
          bounce_rate: num(s.metrics[6]),
          avg_session_duration_sec: num(s.metrics[7]),
          sessions_per_user: num(s.metrics[8]),
          screen_page_views: num(s.metrics[9]),
          views_per_session: num(s.metrics[10]),
          conversions: num(s.metrics[11]),
          total_revenue: num(s.metrics[12]),
        }, { onConflict: 'service_id,report_date' })
        steps.push('daily_summary_ok')
      }

      // =====================================================================
      // 2. ページ別
      // =====================================================================
      const pageRows = await fetchPageMetrics(propertyId, accessToken, targetDate)
      for (const row of pageRows) {
        await supabase.from('ga4_page_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          page_path: row.dims[0],
          page_title: row.dims[1] || null,
          screen_page_views: num(row.metrics[0]),
          total_users: num(row.metrics[1]),
          sessions: num(row.metrics[2]),
          engaged_sessions: num(row.metrics[3]),
          avg_time_on_page_sec: num(row.metrics[4]),
          bounce_rate: num(row.metrics[5]),
          entrances: num(row.metrics[6]),
          exits: num(row.metrics[7]),
          conversions: num(row.metrics[8]),
        }, { onConflict: 'service_id,report_date,page_path' })
      }
      steps.push(`pages_ok(${pageRows.length})`)

      // =====================================================================
      // 3. トラフィックソース
      // =====================================================================
      const trafficRows = await fetchTrafficSources(propertyId, accessToken, targetDate)
      for (const row of trafficRows) {
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
      }
      steps.push(`traffic_ok(${trafficRows.length})`)

      // =====================================================================
      // 4. イベント別
      // =====================================================================
      const eventRows = await fetchEventMetrics(propertyId, accessToken, targetDate)
      for (const row of eventRows) {
        await supabase.from('ga4_event_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          event_name: row.dims[0],
          event_count: num(row.metrics[0]),
          total_users: num(row.metrics[1]),
          conversions: num(row.metrics[2]),
          event_value: num(row.metrics[3]),
        }, { onConflict: 'service_id,report_date,event_name' })
      }
      steps.push(`events_ok(${eventRows.length})`)

      // =====================================================================
      // 5. デバイス別
      // =====================================================================
      const deviceRows = await fetchDeviceMetrics(propertyId, accessToken, targetDate)
      for (const row of deviceRows) {
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
      }
      steps.push(`device_ok(${deviceRows.length})`)

      // =====================================================================
      // 6. 地域別
      // =====================================================================
      const geoRows = await fetchGeoMetrics(propertyId, accessToken, targetDate)
      for (const row of geoRows) {
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
      }
      steps.push(`geo_ok(${geoRows.length})`)

      // 最終同期日時を更新
      await supabase
        .from('service_integrations')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', integ.id)

      // fetch_log を SUCCESS に更新
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

      results.push({ serviceId: integ.service_id, propertyId, date: targetDate, status: 'ok', steps })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ga4-collector] error', { ...logCtx, message })

      await supabase
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

      await supabase
        .from('service_integrations')
        .update({ status: 'error' })
        .eq('id', integ.id)

      results.push({ serviceId: integ.service_id, propertyId, date: targetDate, status: 'error', error: message })
    }
  }

  const errorCount = results.filter((r) => r.status === 'error').length

  return NextResponse.json({
    success: true,
    data: {
      targetDate,
      processedServices: results.length,
      errorCount,
      startedAt,
      finishedAt: new Date().toISOString(),
      results,
    },
  })
}
