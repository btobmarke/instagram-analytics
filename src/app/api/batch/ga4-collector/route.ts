export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { syncGa4OneService, type Ga4IntegrationRow } from '@/lib/batch/ga4-sync-one-service'

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
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
    const r = await syncGa4OneService(supabase, integ as Ga4IntegrationRow, targetDate)
    results.push(
      r.status === 'ok'
        ? { serviceId: r.serviceId, propertyId: r.propertyId, date: r.date, status: 'ok', steps: r.steps }
        : { serviceId: r.serviceId, propertyId: r.propertyId, date: r.date, status: 'error', error: r.error }
    )
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
  const batchStatus = okCount > 0 && errorCount === 0 ? 'success' : okCount > 0 ? 'partial' : 'failed'
  if (jobLog) {
    await supabase.from('batch_job_logs').update({
      status: batchStatus,
      records_processed: okCount,
      records_failed: errorCount,
      finished_at: finishedAt,
      duration_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    }).eq('id', jobLog.id)
  }

  if (batchStatus !== 'success') {
    const errorResults = results.filter(r => r.status === 'error')
    await notifyBatchError({
      jobName: 'ga4_collector',
      processed: okCount,
      errorCount,
      errors: errorResults.map(r => ({ serviceId: r.serviceId, error: r.error ?? '不明なエラー' })),
      executedAt: new Date(startedAt),
    })
  } else {
    await notifyBatchSuccess({
      jobName: 'ga4_collector',
      processed: okCount,
      executedAt: new Date(startedAt),
      lines: [`対象日: ${targetDate}`, `処理サービス数: ${results.length}`],
    })
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
