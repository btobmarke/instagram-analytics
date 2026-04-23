export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET/POST /api/batch/external-data
 *
 * 全プロジェクトの「昨日分」祝日・天気データを取得して
 * project_external_daily に UPSERT するバッチ。
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import { runExternalDataForProject } from '@/lib/batch/queue-job-handlers/external-data-project'

/** JST の昨日 YYYY-MM-DD */
function jstYesterday(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  jst.setUTCDate(jst.getUTCDate() - 1)
  return jst.toISOString().slice(0, 10)
}

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

export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('external-data', request)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runBatch(request)
}

async function runBatch(_request: NextRequest) {
  const admin = createSupabaseAdminClient()
  const startedAt = new Date()

  const url = new URL(_request.url)
  const targetDate = url.searchParams.get('date') ?? jstYesterday()
  const projectFilter = url.searchParams.get('project')

  const { data: jobLog } = await admin
    .from('batch_job_logs')
    .insert({
      job_name: 'external_data',
      status: 'running',
      started_at: startedAt.toISOString(),
    })
    .select('id')
    .single()
  const jobLogId = jobLog?.id

  let processed = 0
  let errors = 0

  try {
    let projQ = admin.from('projects').select('id').eq('is_active', true)
    if (projectFilter) projQ = projQ.eq('id', projectFilter)
    const { data: projects, error: projErr } = await projQ

    if (projErr || !projects) {
      throw new Error(`projects 取得失敗: ${projErr?.message}`)
    }

    for (const p of projects) {
      try {
        await runExternalDataForProject(admin, { project_id: p.id, target_date: targetDate })
        processed++
      } catch (e) {
        console.error(`[external-data] project=${p.id} error:`, e)
        errors++
      }
    }

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const finalStatus = errors === 0 ? 'success' : processed > 0 ? 'partial' : 'failed'

    if (jobLogId) {
      await admin
        .from('batch_job_logs')
        .update({
          status: finalStatus,
          finished_at: finishedAt.toISOString(),
          duration_ms: durationMs,
          records_processed: processed,
          error_message: errors > 0 ? `${errors} 件のプロジェクトでエラー` : null,
        })
        .eq('id', jobLogId)
    }

    if (finalStatus === 'success') {
      await notifyBatchSuccess({
        jobName: 'external_data',
        processed,
        executedAt: startedAt,
        lines: [`対象日: ${targetDate}`],
      })
    } else {
      await notifyBatchError({
        jobName: 'external_data',
        processed,
        errorCount: errors,
        errors: [{ error: `${errors} 件のプロジェクトでエラー` }],
        executedAt: startedAt,
      })
    }

    return NextResponse.json({
      success: true,
      date: targetDate,
      processed,
      errors,
      status: finalStatus,
      durationMs,
    })
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr)
    console.error('[external-data] fatal error:', fatalErr)

    if (jobLogId) {
      await admin
        .from('batch_job_logs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: msg,
        })
        .eq('id', jobLogId)
    }

    await notifyBatchError({
      jobName: 'external_data',
      processed: 0,
      errorCount: 1,
      errors: [{ error: msg }],
      executedAt: startedAt,
    })

    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
