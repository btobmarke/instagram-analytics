import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/utils/crypto'
import { throwOnDbError } from '@/lib/utils/supabase-assert'
import {
  fetchClarityDailySummary,
  fetchClarityPageMetrics,
  fetchClarityDeviceMetrics,
} from '@/lib/clarity/client'

export type ClarityIntegrationRow = {
  id: string
  service_id: string
  external_project_id: string | null
  encrypted_credential: string | null
  status: string
}

export type ClaritySyncOneResult = {
  serviceId: string
  projectId: string
  date: string
  status: 'ok' | 'error'
  error?: string
  steps?: string[]
}

export async function syncClarityOneService(
  supabase: SupabaseClient,
  integ: ClarityIntegrationRow,
  targetDate: string
): Promise<ClaritySyncOneResult> {
  const projectId = integ.external_project_id ?? ''
  const steps: string[] = []
  const logCtx = { serviceId: integ.service_id, projectId, date: targetDate }

  throwOnDbError(
    'external_fetch_logs insert',
    await supabase.from('external_fetch_logs').insert({
      service_id: integ.service_id,
      integration_type: 'CLARITY',
      fetch_target_date: targetDate,
      fetch_status: 'STARTED',
      response_summary: null,
      started_at: new Date().toISOString(),
    })
  )

  try {
    if (!projectId) throw new Error('Clarity プロジェクト ID が未設定です')
    if (!integ.encrypted_credential) throw new Error('Clarity API キーが未設定です')

    const credJson = decrypt(integ.encrypted_credential)
    const cred = JSON.parse(credJson) as { apiKey: string; projectId?: string }
    const apiKey = cred.apiKey
    if (!apiKey) throw new Error('apiKey が credential に含まれていません')
    steps.push('auth_ok')

    const daily = await fetchClarityDailySummary(projectId, apiKey, targetDate)
    throwOnDbError(
      'clarity_daily_metrics upsert',
      await supabase.from('clarity_daily_metrics').upsert({
        service_id: integ.service_id,
        report_date: targetDate,
        total_sessions: daily.totalSessionCount,
        total_users: daily.totalUserCount,
        pages_per_session: daily.pagesPerSession,
        scroll_depth_avg_pct: daily.scrollDepthAvgPct,
        active_time_sec_avg: daily.activeTimeSecAvg,
        rage_click_sessions: daily.rageClickSessionCount,
        dead_click_sessions: daily.deadClickSessionCount,
        quick_back_sessions: daily.quickBackSessionCount,
        excessive_scroll_sessions: daily.excessiveScrollSessionCount,
        js_error_sessions: daily.jsErrorSessionCount,
        bot_sessions: daily.botSessionCount,
      }, { onConflict: 'service_id,report_date' })
    )
    steps.push('daily_summary_ok')

    const pages = await fetchClarityPageMetrics(projectId, apiKey, targetDate)
    for (const p of pages) {
      if (!p.pageUrl) continue
      throwOnDbError(
        'clarity_page_metrics upsert',
        await supabase.from('clarity_page_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          page_url: p.pageUrl,
          sessions: p.sessionCount,
          total_users: p.userCount,
          scroll_depth_avg_pct: p.scrollDepthAvgPct,
          active_time_sec_avg: p.activeTimeSecAvg,
          rage_clicks: p.rageClicks,
          dead_clicks: p.deadClicks,
          quick_backs: p.quickBacks,
          js_errors: p.jsErrors,
        }, { onConflict: 'service_id,report_date,page_url' })
      )
    }
    steps.push(`pages_ok(${pages.length})`)

    const devices = await fetchClarityDeviceMetrics(projectId, apiKey, targetDate)
    for (const d of devices) {
      throwOnDbError(
        'clarity_device_metrics upsert',
        await supabase.from('clarity_device_metrics').upsert({
          service_id: integ.service_id,
          report_date: targetDate,
          device_type: d.deviceType || '(not set)',
          browser: d.browser,
          os: d.os,
          sessions: d.sessionCount,
          total_users: d.userCount,
        }, { onConflict: 'service_id,report_date,device_type,browser,os' })
      )
    }
    steps.push(`device_ok(${devices.length})`)

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
        .eq('integration_type', 'CLARITY')
        .eq('fetch_target_date', targetDate)
        .eq('fetch_status', 'STARTED')
    )

    return { serviceId: integ.service_id, projectId, date: targetDate, status: 'ok', steps }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[clarity-collector] error', { ...logCtx, message })

    const failLog = await supabase
      .from('external_fetch_logs')
      .update({
        fetch_status: 'FAILED',
        response_summary: message,
        finished_at: new Date().toISOString(),
      })
      .eq('service_id', integ.service_id)
      .eq('integration_type', 'CLARITY')
      .eq('fetch_target_date', targetDate)
      .eq('fetch_status', 'STARTED')
    if (failLog.error) {
      console.error('[clarity-collector] external_fetch_logs FAILED update failed', failLog.error)
    }

    return { serviceId: integ.service_id, projectId, date: targetDate, status: 'error', error: message }
  }
}
