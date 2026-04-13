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
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { throwOnDbError } from '@/lib/utils/supabase-assert'

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

/** GA4 が小数文字列を返すことがある INT 列向け */
function intMetric(v: string | undefined): number {
  return Math.round(num(v))
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
 * Authorization: Bearer {CRON_SECRET または BATCH_SECRET}
 */
export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('ga4-collector', request)
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

  // batch_job_logs INSERT
  const { data: jobLog } = await supabase.from('batch_job_logs').insert({
    job_name: 'ga4_collector',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt,
  }).select().single()

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

  console.info('[ga4-collector] start', {
    targetDate,
    activeIntegrationCount: integrations?.length ?? 0,
  })

  if (!integrations?.length) {
    console.warn(
      '[ga4-collector] no active GA4 integrations (service_integrations: integration_type=GA4, status=active)'
    )
    return NextResponse.json(
      {
        success: false,
        hint_ja:
          'アクティブな GA4 連携がありません。プロジェクトのサービス連携で GA4 を登録し、連携の status が active か確認してください。',
        error: { code: 'NO_INTEGRATIONS', message: 'No active GA4 integrations' },
        data: {
          targetDate,
          processedServices: 0,
          errorCount: 0,
          results: [],
          startedAt,
          finishedAt: new Date().toISOString(),
        },
      },
      { status: 200 }
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

      // --- 認証 ---
      const saJson = decrypt(integ.encrypted_credential)
      const sa = parseServiceAccount(saJson)
      const accessToken = await getAccessToken(sa)
      steps.push('auth_ok')

      // =====================================================================
      // 1. 日次サマリー
      // =====================================================================
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

      // =====================================================================
      // 2. ページ別
      // =====================================================================
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
            // entrances=eventCount, exits=screenPageViewsPerSession（小数）。DB が INT のままでは 22P02 になるため整数化
            entrances: intMetric(row.metrics[6]),
            exits: intMetric(row.metrics[7]),
            conversions: intMetric(row.metrics[8]),
          }, { onConflict: 'service_id,report_date,page_path' })
        )
      }
      steps.push(`pages_ok(${pageRows.length})`)

      // =====================================================================
      // 3. トラフィックソース
      // =====================================================================
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

      // =====================================================================
      // 4. イベント別
      // =====================================================================
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

      // =====================================================================
      // 5. デバイス別
      // =====================================================================
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

      // =====================================================================
      // 6. 地域別
      // =====================================================================
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

      // 最終同期日時を更新
      throwOnDbError(
        'service_integrations update',
        await supabase
          .from('service_integrations')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', integ.id)
      )

      // fetch_log を SUCCESS に更新
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

      results.push({ serviceId: integ.service_id, propertyId, date: targetDate, status: 'ok', steps })
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

      // 一時的なAPIエラーで status を変えると再登録が必要になるため更新しない
      // エラーは external_fetch_logs の FAILED レコードで追跡する
      results.push({ serviceId: integ.service_id, propertyId, date: targetDate, status: 'error', error: message })
    }
  }

  const errorCount = results.filter((r) => r.status === 'error').length
  const okCount = results.filter((r) => r.status === 'ok').length
  const finishedAt = new Date().toISOString()

  console.info('[ga4-collector] end', {
    targetDate,
    processedServices: results.length,
    okCount,
    errorCount,
  })

  // batch_job_logs UPDATE
  if (jobLog) {
    const batchStatus = okCount > 0 && errorCount === 0 ? 'success' : okCount > 0 ? 'partial' : 'failed'
    await supabase.from('batch_job_logs').update({
      status: batchStatus,
      records_processed: okCount,
      records_failed: errorCount,
      finished_at: finishedAt,
      duration_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    }).eq('id', jobLog.id)
  }

  return NextResponse.json({
    success: okCount > 0,
    hint_ja:
      okCount === 0 && results.length > 0
        ? 'すべてのサービスで取得に失敗しました。results[].error とサーバーログを確認してください。'
        : undefined,
    data: {
      targetDate,
      processedServices: results.length,
      okCount,
      errorCount,
      startedAt,
      finishedAt,
      results,
    },
  })
}

// Vercel Cron は GET で呼び出す
export async function GET(request: NextRequest) {
  return POST(request)
}
