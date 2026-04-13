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
import {
  fetchMetricsByRefs,
  buildPeriods,
} from '@/lib/summary/fetch-metrics'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

/** JST の昨日 YYYY-MM-DD */
function jstYesterday(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  jst.setUTCDate(jst.getUTCDate() - 1)
  return jst.toISOString().slice(0, 10)
}

// GET ← Vercel Cron
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    const qSecret    = new URL(request.url).searchParams.get('secret')
    const provided   = authHeader?.replace('Bearer ', '') ?? qSecret ?? ''
    if (provided !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  return runBatch(request)
}

// POST でも手動実行可
export async function POST(request: NextRequest) {
  return GET(request)
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
    // 対象プロジェクトのアクティブサービスを一括取得
    let svcQuery = admin
      .from('services')
      .select('id, service_name, service_type, project_id')
      .is('deleted_at', null)
      .eq('is_active', true)

    if (targetProject) {
      svcQuery = svcQuery.eq('project_id', targetProject)
    }

    const { data: services, error: svcErr } = await svcQuery
    if (svcErr || !services) {
      throw new Error(`services 取得失敗: ${svcErr?.message}`)
    }

    // 対象日を「1日分」の Period として構築
    // buildPeriods は SupabaseServerClient を必要としないので直接呼ぶ
    const periodsOrError = buildPeriods('day', 1,
      // count=1 では today になるので custom_range で1日を指定
      undefined, undefined,
    )
    // count=1 の day では "今日" が取れてしまうため custom_range で指定
    const targetPeriods = (() => {
      const p = buildPeriods('custom_range', 1, targetDate, targetDate)
      if ('error' in p) throw new Error(p.error)
      return p
    })()

    // サービスごとに処理（エラーが出ても他は続行）
    for (const svc of services) {
      try {
        const catalog = getMetricCatalog(svc.service_type)
        if (catalog.length === 0) continue  // カタログのないサービスはスキップ

        const fieldRefs = catalog.map(c => c.id)

        // fetch-metrics の関数群を使ってデータ取得
        // admin client は SupabaseServerClient と同じインターフェースを持つ
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await fetchMetricsByRefs(admin as any, svc.id, fieldRefs, targetPeriods)

        // UPSERT 行を構築
        // custom_range のラベルは "YYYYMMDD~YYYYMMDD" 形式なので period label で値を取る
        const periodLabel = targetPeriods[0].label
        const upsertRows = fieldRefs.map(ref => ({
          project_id: svc.project_id,
          service_id: svc.id,
          date:       targetDate,
          metric_ref: ref,
          value:      rawData[ref]?.[periodLabel] ?? null,
          updated_at: new Date().toISOString(),
        }))

        // 500件ずつに分割して UPSERT（Supabase の上限対策）
        const CHUNK = 500
        for (let i = 0; i < upsertRows.length; i += CHUNK) {
          const chunk = upsertRows.slice(i, i + CHUNK)
          const { error: upsertErr } = await admin
            .from('project_metrics_daily')
            .upsert(chunk, { onConflict: 'project_id,service_id,date,metric_ref' })

          if (upsertErr) {
            console.error(`[project-metrics-aggregate] upsert error svc=${svc.id}:`, upsertErr)
            totalErrors++
          } else {
            totalUpserted += chunk.length
          }
        }
      } catch (e) {
        console.error(`[project-metrics-aggregate] service=${svc.id} error:`, e)
        totalErrors++
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

    return NextResponse.json({
      success:      true,
      date:         targetDate,
      services:     services.length,
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

    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }

  // TypeScript の exhaustive check 用（到達しない）
  void periodsOrError
}
