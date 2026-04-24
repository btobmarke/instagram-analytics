export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5分（Vercel Pro上限）

/**
 * GET/POST /api/batch/project-metrics-aggregate
 *
 * 全プロジェクト・全アクティブサービスの前日分指標を集計して
 * project_metrics_daily に UPSERT するバッチ。
 *
 * 実行タイミング: 各サービスバッチ完了後の JST 06:00（UTC 21:00 前日）
 * vercel.json: { "path": "/api/batch/project-metrics-aggregate", "schedule": "0 21 * * *" }
 *
 * クエリパラメータ:
 *   date     YYYY-MM-DD  対象日（省略時は JST 昨日）
 *   project  UUID        特定プロジェクトのみ処理（省略時は全件）
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { runProjectMetricsAggregateForProject } from '@/lib/batch/project-metrics-aggregate-one-project'

/** JST の昨日 YYYY-MM-DD */
function jstYesterday(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  jst.setUTCDate(jst.getUTCDate() - 1)
  return jst.toISOString().slice(0, 10)
}

// GET ← Vercel Cron
export async function GET(request: NextRequest) {
  if (validateBatchRequest(request)) {
    return runBatch(request)
  }
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    const qSecret = new URL(request.url).searchParams.get('secret')
    const provided = authHeader?.replace(/^Bearer\s+/i, '')?.trim() ?? qSecret ?? ''
    if (provided !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  return runBatch(request)
}

// POST でも手動実行可
export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('project-metrics-aggregate', request)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runBatch(request)
}

// ── バッチ本体 ───────────────────────────────────────────────────────────────

async function runBatch(request: NextRequest) {
  const admin     = createSupabaseAdminClient()
  const startedAt = new Date()

  const url           = new URL(request.url)
  const targetDate    = url.searchParams.get('date')    ?? jstYesterday()
  const targetProject = url.searchParams.get('project') ?? null   // 特定PJ絞り込み用

  // batch_job_logs 開始記録
  const { data: jobLog } = await admin
    .from('batch_job_logs')
    .insert({
      job_name:   'project_metrics_aggregate',
      status:     'running',
      started_at: startedAt.toISOString(),
    })
    .select('id')
    .single()
  const jobLogId = jobLog?.id

  let totalUpserted = 0
  let totalErrors   = 0

  try {
    let serviceCountForNotify = 0

    if (targetProject) {
      const r = await runProjectMetricsAggregateForProject(admin, targetProject, targetDate)
      totalUpserted = r.upserted
      totalErrors = r.errors
      serviceCountForNotify = r.services
    } else {
      const { data: projectRows, error: pErr } = await admin.from('projects').select('id').eq('is_active', true)
      if (pErr || !projectRows) {
        throw new Error(`projects 取得失敗: ${pErr?.message}`)
      }
      for (const p of projectRows) {
        const r = await runProjectMetricsAggregateForProject(admin, p.id, targetDate)
        totalUpserted += r.upserted
        totalErrors += r.errors
        serviceCountForNotify += r.services
      }
    }

    const finishedAt  = new Date()
    const durationMs  = finishedAt.getTime() - startedAt.getTime()
    const finalStatus = totalErrors === 0
      ? 'success'
      : totalUpserted > 0 ? 'partial' : 'failed'

    if (jobLogId) {
      await admin
        .from('batch_job_logs')
        .update({
          status:            finalStatus,
          finished_at:       finishedAt.toISOString(),
          duration_ms:       durationMs,
          records_processed: totalUpserted,
          error_message:     totalErrors > 0 ? `${totalErrors} サービスでエラー` : null,
        })
        .eq('id', jobLogId)
    }

    if (finalStatus === 'success') {
      await notifyBatchSuccess({
        jobName: 'project_metrics_aggregate',
        processed: totalUpserted,
        executedAt: startedAt,
        lines: [
          `対象日: ${targetDate}`,
          `対象サービス数（概算）: ${serviceCountForNotify}`,
          ...(targetProject ? [`project: ${targetProject}`] : []),
        ],
      })
    } else {
      await notifyBatchError({
        jobName: 'project_metrics_aggregate',
        processed: totalUpserted,
        errorCount: totalErrors,
        errors: [{ error: `${totalErrors} サービスでエラー` }],
        executedAt: startedAt,
      })
    }

    return NextResponse.json({
      success:      true,
      date:         targetDate,
      services:     serviceCountForNotify,
      upserted:     totalUpserted,
      errors:       totalErrors,
      status:       finalStatus,
      durationMs,
    })
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr)
    console.error('[project-metrics-aggregate] fatal error:', fatalErr)

    if (jobLogId) {
      await admin
        .from('batch_job_logs')
        .update({
          status:        'failed',
          finished_at:   new Date().toISOString(),
          error_message: msg,
        })
        .eq('id', jobLogId)
    }

    await notifyBatchError({
      jobName: 'project_metrics_aggregate',
      processed: 0,
      errorCount: 1,
      errors: [{ error: msg }],
      executedAt: startedAt,
    })

    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }

}
