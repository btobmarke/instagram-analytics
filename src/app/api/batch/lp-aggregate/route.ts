import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchSuccess } from '@/lib/batch-notify'

// バッチは service_role キーで実行（RLS bypass）
function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const RANGES = ['all', '30d', '7d', 'today'] as const
type RangeType = typeof RANGES[number]

function getRangeStart(range: RangeType): string | null {
  const now = new Date()
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    case 'all':
      return null
  }
}

/**
 * POST /api/batch/lp-aggregate
 * LP 集計バッチ (BAT-003)
 *
 * 全アクティブな LP サービスの metric_summaries / ranking_summaries を更新する。
 * Authorization: Bearer {CRON_SECRET または BATCH_SECRET} で認証。
 */
export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('lp-aggregate', request)
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'バッチ認証に失敗しました' } },
      { status: 401 }
    )
  }

  const supabase = createServiceRoleClient()
  const startedAt = new Date().toISOString()
  const today = new Date().toISOString().slice(0, 10)

  // batch_job_logs INSERT
  const { data: jobLog } = await supabase.from('batch_job_logs').insert({
    job_name: 'lp_aggregate',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt,
  }).select().single()

  // アクティブな LP サービス一覧取得
  const { data: lpSites, error: siteError } = await supabase
    .from('lp_sites')
    .select('id, service_id')
    .eq('is_active', true)

  if (siteError) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: 'LP一覧取得に失敗しました' } },
      { status: 500 }
    )
  }

  const results: Array<{ lpSiteId: string; range: string; status: string; error?: string }> = []

  for (const lpSite of lpSites ?? []) {
    for (const range of RANGES) {
      try {
        const rangeStart = getRangeStart(range)

        // セッション集計
        let sessionQuery = supabase
          .from('lp_sessions')
          .select('id, lp_user_id, duration_seconds, session_intent_score')
          .eq('lp_site_id', lpSite.id)

        if (rangeStart) sessionQuery = sessionQuery.gte('started_at', rangeStart)

        const { data: sessions } = await sessionQuery
        const allSessions = sessions ?? []

        const sessionCount = allSessions.length
        const uniqueUserIds = new Set(allSessions.map(s => s.lp_user_id))
        const userCount = uniqueUserIds.size

        const durationsWithValue = allSessions.filter(s => s.duration_seconds > 0)
        const avgStaySeconds =
          durationsWithValue.length > 0
            ? durationsWithValue.reduce((sum, s) => sum + s.duration_seconds, 0) / durationsWithValue.length
            : 0

        const hotSessions = allSessions.filter(s => s.session_intent_score > 0).length
        const hotRate = sessionCount > 0 ? (hotSessions / sessionCount) * 100 : 0

        // metric_summaries に upsert
        const metrics = [
          { metric_name: 'session_count', value: sessionCount },
          { metric_name: 'user_count', value: userCount },
          { metric_name: 'avg_stay_seconds', value: Math.round(avgStaySeconds * 10) / 10 },
          { metric_name: 'hot_session_rate', value: Math.round(hotRate * 10) / 10 },
        ]

        for (const metric of metrics) {
          await supabase.from('metric_summaries').upsert({
            service_id: lpSite.service_id,
            metric_name: metric.metric_name,
            range_type: range,
            value: metric.value,
            source_type: 'MA',
            summary_date: today,
          }, { onConflict: 'service_id,metric_name,range_type,summary_date' })
        }

        results.push({ lpSiteId: lpSite.id, range, status: 'ok' })
      } catch (err) {
        results.push({
          lpSiteId: lpSite.id,
          range,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  const finishedAt = new Date().toISOString()
  const errorCount = results.filter(r => r.status === 'error').length
  const okSites = lpSites?.length ?? 0

  // batch_job_logs UPDATE
  if (jobLog) {
    const batchStatus = errorCount === 0 ? 'success' : okSites > 0 ? 'partial' : 'failed'
    await supabase.from('batch_job_logs').update({
      status: batchStatus,
      records_processed: okSites,
      records_failed: errorCount,
      finished_at: finishedAt,
      duration_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    }).eq('id', jobLog.id)
  }

  if (errorCount === 0) {
    await notifyBatchSuccess({
      jobName: 'lp_aggregate',
      processed: okSites,
      executedAt: new Date(startedAt),
      lines: [`集計日: ${today}`, `レンジ: ${RANGES.join(', ')}`],
    })
  }

  return NextResponse.json({
    success: true,
    data: {
      processedSites: okSites,
      totalTasks: results.length,
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
