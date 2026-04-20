import type { SupabaseClient } from '@supabase/supabase-js'
import { lineMessagingMulticast } from '@/lib/line/messaging-api'
import { chunkArray } from '@/lib/line/chunk-array'
import { LINE_MULTICAST_CHUNK_PAUSE_MS, LINE_MULTICAST_MAX_TO } from '@/lib/line/messaging-broadcast-constants'

export type BroadcastJobRow = {
  id: string
  service_id: string
  snapshot_body_text: string
  status: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 1 ジョブについて、pending の受信者を最大 maxChunks チャンク（各 500 件）まで multicast 送信する。
 * ジョブが cancelled になったら中断。処理後に全受信者が終端なら completed / failed を更新。
 */
export async function processBroadcastJobChunk(
  supabase: SupabaseClient,
  job: BroadcastJobRow,
  channelAccessToken: string,
  opts?: { maxChunks?: number },
): Promise<{
  chunksSent: number
  lastError: string | null
  aborted: boolean
}> {
  const maxChunks = opts?.maxChunks ?? 12
  let chunksSent = 0
  let lastError: string | null = null

  for (let c = 0; c < maxChunks; c++) {
    const { data: jobRow } = await supabase
      .from('line_messaging_broadcast_jobs')
      .select('status')
      .eq('id', job.id)
      .single()

    if (jobRow?.status === 'cancelled') {
      return { chunksSent, lastError, aborted: true }
    }

    const { data: pending, error: pendErr } = await supabase
      .from('line_messaging_broadcast_recipients')
      .select('id, line_user_id')
      .eq('job_id', job.id)
      .eq('status', 'pending')
      .order('line_user_id')
      .limit(LINE_MULTICAST_MAX_TO)

    if (pendErr || !pending?.length) {
      break
    }

    const to = pending.map((r) => r.line_user_id)
    const messages = [{ type: 'text' as const, text: job.snapshot_body_text }]
    const result = await lineMessagingMulticast(channelAccessToken, to, messages)

    if (!result.ok) {
      lastError = `${result.status}: ${result.message}`
      const now = new Date().toISOString()
      await supabase
        .from('line_messaging_broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError,
          line_request_id: result.requestId ?? null,
          updated_at: now,
        })
        .in(
          'id',
          pending.map((p) => p.id),
        )
      await supabase
        .from('line_messaging_broadcast_jobs')
        .update({
          status: 'failed',
          last_error: lastError,
          completed_at: now,
          updated_at: now,
        })
        .eq('id', job.id)
      chunksSent++
      return { chunksSent, lastError, aborted: false }
    }

    const now = new Date().toISOString()
    await supabase
      .from('line_messaging_broadcast_recipients')
      .update({
        status: 'sent',
        sent_at: now,
        line_request_id: result.requestId ?? null,
        error_message: null,
        updated_at: now,
      })
      .in(
        'id',
        pending.map((p) => p.id),
      )

    chunksSent++
    if (pending.length < LINE_MULTICAST_MAX_TO) {
      break
    }
    if (c + 1 < maxChunks) await sleep(LINE_MULTICAST_CHUNK_PAUSE_MS)
  }

  const { count: pendingCount } = await supabase
    .from('line_messaging_broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', job.id)
    .eq('status', 'pending')

  const nowIso = new Date().toISOString()
  if ((pendingCount ?? 0) === 0) {
    const { count: failCount } = await supabase
      .from('line_messaging_broadcast_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', job.id)
      .eq('status', 'failed')

    const finalStatus = (failCount ?? 0) > 0 ? 'failed' : 'completed'
    await supabase
      .from('line_messaging_broadcast_jobs')
      .update({
        status: finalStatus,
        completed_at: nowIso,
        last_error: finalStatus === 'failed' ? lastError : null,
        updated_at: nowIso,
      })
      .eq('id', job.id)
  }

  return { chunksSent, lastError, aborted: false }
}

/** 明示リストをチャンクに分け、既存の pending とマージしても使わない（1 受信者 1 行） */
export function normalizeExplicitUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    const s = typeof x === 'string' ? x.trim() : ''
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

export async function seedBroadcastRecipients(
  supabase: SupabaseClient,
  jobId: string,
  lineUserIds: string[],
): Promise<{ error?: string }> {
  const chunks = chunkArray(lineUserIds, 200)
  for (const part of chunks) {
    const rows = part.map((line_user_id) => ({
      job_id: jobId,
      line_user_id,
      status: 'pending' as const,
    }))
    const { error } = await supabase.from('line_messaging_broadcast_recipients').insert(rows)
    if (error) return { error: error.message }
  }
  return {}
}
