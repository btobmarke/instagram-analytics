export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateBatchRequest, logBatchAuthFailure } from '@/lib/utils/batch-auth'
import { notifyBatchSuccess, notifyBatchError } from '@/lib/batch-notify'
import {
  groupInsightFactsByMedia,
  milestoneCumulativeSummary,
} from '@/lib/instagram/post-insight-chart'

/** sortedAsc 昇順、長さ4以上で p=0.75 の近似パーセンタイル */
function percentileSorted(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length < 4) return null
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(p * sortedAsc.length) - 1)
  return sortedAsc[idx]
}

/**
 * 週次: アカウントごとに直近7日投稿の「公開後6hリーチ」を集計し、
 * - トップ投稿のレトロ要約を通知行に載せる
 * - 同一週データの 75 パーセンタイルの 1.4 倍以上の初速を「アラート」行に載せる（相対基準）
 */
async function runBatch() {
  const admin = createSupabaseAdminClient()
  const startedAt = new Date()

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'instagram_velocity_retro',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  const lines: string[] = []
  let processed = 0

  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    const { data: accounts } = await admin.from('ig_accounts').select('id, username').eq('status', 'active')

    for (const account of accounts ?? []) {
      const { data: medias } = await admin
        .from('ig_media')
        .select('id, posted_at, media_product_type, media_type')
        .eq('account_id', account.id)
        .eq('is_deleted', false)
        .gte('posted_at', weekAgo)
        .order('posted_at', { ascending: false })
        .limit(80)

      const ids = (medias ?? []).map(m => m.id)
      if (ids.length === 0) continue

      const { data: facts } = await admin
        .from('ig_media_insight_fact')
        .select('media_id, metric_code, snapshot_at, value')
        .in('media_id', ids)
        .in('metric_code', ['reach', 'likes', 'saved'])
        .order('snapshot_at', { ascending: true })
        .limit(20000)

      const grouped = groupInsightFactsByMedia(facts ?? [])

      const rows: Array<{ id: string; posted_at: string; reach6: number | null; likes6: number | null }> = []
      for (const m of medias ?? []) {
        const ts = grouped[m.id] ?? {}
        const ms = milestoneCumulativeSummary(m.posted_at, ts, ['reach', 'likes', 'saved'])
        rows.push({
          id: m.id,
          posted_at: m.posted_at,
          reach6: ms['6h'].reach ?? null,
          likes6: ms['6h'].likes ?? null,
        })
      }

      const reachVals = rows.map(r => r.reach6).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b)
      const p75 = percentileSorted(reachVals, 0.75)

      const top = [...rows]
        .filter(r => r.reach6 != null)
        .sort((a, b) => (b.reach6 ?? 0) - (a.reach6 ?? 0))
        .slice(0, 3)

      if (top.length > 0) {
        lines.push(
          `@${account.username}: 7日以内トップ初速(6h reach) — ` +
            top.map(t => `${t.id.slice(0, 8)}=${(t.reach6 ?? 0).toLocaleString()}`).join(', ')
        )
      }

      const now = Date.now()
      for (const r of rows) {
        const posted = new Date(r.posted_at).getTime()
        const ageH = (now - posted) / 3600000
        if (ageH < 6 || ageH > 96) continue
        if (p75 == null || r.reach6 == null || r.reach6 < p75 * 1.4) continue
        lines.push(
          `⚡初速注意 @${account.username}: ${r.id.slice(0, 8)} 6h reach ${r.reach6.toLocaleString()}（週内上位の約1.4倍目安）`
        )
      }

      processed++
    }

    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'success',
        records_processed: processed,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }

    await notifyBatchSuccess({
      jobName: 'instagram_velocity_retro',
      processed,
      executedAt: startedAt,
      lines: lines.length ? lines : ['該当サマリーなし（投稿・インサイト不足）'],
    })

    return NextResponse.json({ success: true, processed, lines: lines.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'instagram_velocity_retro',
      processed: 0,
      errorCount: 1,
      errors: [{ error: message }],
      executedAt: startedAt,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('instagram-velocity-retro', request)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runBatch()
}

export async function GET(request: Request) {
  return POST(request)
}
