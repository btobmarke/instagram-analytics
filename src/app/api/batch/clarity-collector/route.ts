export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/utils/crypto'
import {
  fetchClarityDailySummary,
  fetchClarityPageMetrics,
  fetchClarityDeviceMetrics,
} from '@/lib/clarity/client'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { throwOnDbError } from '@/lib/utils/supabase-assert'

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/batch/clarity-collector
 *
 * Clarity データ収集バッチ。
 * service_integrations に integration_type='CLARITY' が登録されているサービスに対して
 * 前日（または指定日）を report_date に記録しつつ、Clarity Data Export API（直近 1〜3 日のローリング窓）から取得したデータを各テーブルに upsert する。
 *
 * Body (optional):
 *   { "date": "YYYY-MM-DD", "service_id": "uuid" }
 *
 * Authorization: Bearer {CRON_SECRET または BATCH_SECRET}
 *
 * encrypted_credential の形式:
 *   encrypt(JSON.stringify({ apiKey: "...", projectId: "..." }))
 *   ※ external_project_id にも projectId を保存しておく（参照用）
 */
export async function POST(request: NextRequest) {
  // --- 認証（他バッチと同じ CRON_SECRET / 旧 BATCH_SECRET）---
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('clarity-collector', request)
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

  // --- Clarity 連携設定を取得 ---
  let integQuery = supabase
    .from('service_integrations')
    .select('id, service_id, external_project_id, encrypted_credential, status')
    .eq('integration_type', 'CLARITY')
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

  console.info('[clarity-collector] start', {
    targetDate,
    activeIntegrationCount: integrations?.length ?? 0,
  })

  if (!integrations?.length) {
    console.warn(
      '[clarity-collector] no active Clarity integrations (service_integrations: integration_type=CLARITY, status=active)'
    )
    return NextResponse.json(
      {
        success: false,
        hint_ja:
          'アクティブな Clarity 連携がありません。サービス連携で Clarity を登録し、status が active か確認してください。',
        error: { code: 'NO_INTEGRATIONS', message: 'No active Clarity integrations' },
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
    projectId: string
    date: string
    status: 'ok' | 'error'
    error?: string
    steps?: string[]
  }> = []

  for (const integ of integrations ?? []) {
    const projectId = integ.external_project_id ?? ''
    const steps: string[] = []
    const logCtx = { serviceId: integ.service_id, projectId, date: targetDate }

    // fetch_log を STARTED に記録
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

      // --- 認証情報を復号 ---
      const credJson = decrypt(integ.encrypted_credential)
      const cred = JSON.parse(credJson) as { apiKey: string; projectId?: string }
      const apiKey = cred.apiKey
      if (!apiKey) throw new Error('apiKey が credential に含まれていません')
      steps.push('auth_ok')

      // =================================================================
      // 1. 日次サマリー
      // =================================================================
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

      // =================================================================
      // 2. ページ別
      // =================================================================
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

      // =================================================================
      // 3. デバイス別
      // =================================================================
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
          .eq('integration_type', 'CLARITY')
          .eq('fetch_target_date', targetDate)
          .eq('fetch_status', 'STARTED')
      )

      results.push({ serviceId: integ.service_id, projectId, date: targetDate, status: 'ok', steps })
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

      // 一時的なAPIエラーで status を変えると再登録が必要になるため更新しない
      // エラーは external_fetch_logs の FAILED レコードで追跡する
      results.push({ serviceId: integ.service_id, projectId, date: targetDate, status: 'error', error: message })
    }
  }

  const errorCount = results.filter((r) => r.status === 'error').length
  const okCount = results.filter((r) => r.status === 'ok').length
  const finishedAt = new Date().toISOString()

  console.info('[clarity-collector] end', {
    targetDate,
    processedServices: results.length,
    okCount,
    errorCount,
  })

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
