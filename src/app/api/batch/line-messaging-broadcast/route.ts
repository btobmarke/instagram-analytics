import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { decrypt } from '@/lib/utils/crypto'
import {
  processBroadcastJobChunk,
  type BroadcastJobRow,
} from '@/lib/line/process-broadcast-job-chunk'

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * POST /api/batch/line-messaging-broadcast
 * 予約時刻を過ぎた一斉配信ジョブを処理（multicast チャンク・レート制限）
 *
 * Authorization: Bearer CRON_SECRET | BATCH_SECRET
 * 推奨: 1〜5 分間隔
 */
export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('line-messaging-broadcast', request)
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'バッチ認証に失敗しました' } },
      { status: 401 },
    )
  }

  const supabase = createServiceRoleClient()
  const nowIso = new Date().toISOString()

  const { data: jobs, error: jobErr } = await supabase
    .from('line_messaging_broadcast_jobs')
    .select('id, service_id, snapshot_body_text, status')
    .in('status', ['scheduled', 'processing'])
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(5)

  if (jobErr) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: jobErr.message } },
      { status: 500 },
    )
  }

  const processed: { job_id: string; chunks: number; aborted?: boolean }[] = []

  for (const row of jobs ?? []) {
    if (row.status === 'scheduled') {
      await supabase
        .from('line_messaging_broadcast_jobs')
        .update({
          status: 'processing',
          started_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', row.id)
    }

    const { data: cred } = await supabase
      .from('line_messaging_service_credentials')
      .select('channel_access_token_enc')
      .eq('service_id', row.service_id)
      .maybeSingle()

    if (!cred?.channel_access_token_enc) {
      await supabase
        .from('line_messaging_broadcast_jobs')
        .update({
          status: 'failed',
          last_error: 'messaging credentials not configured',
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', row.id)
      processed.push({ job_id: row.id, chunks: 0 })
      continue
    }

    let token: string
    try {
      token = decrypt(cred.channel_access_token_enc)
    } catch {
      await supabase
        .from('line_messaging_broadcast_jobs')
        .update({
          status: 'failed',
          last_error: 'credential decrypt failed',
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', row.id)
      processed.push({ job_id: row.id, chunks: 0 })
      continue
    }

    const job: BroadcastJobRow = {
      id: row.id,
      service_id: row.service_id,
      snapshot_body_text: row.snapshot_body_text,
      status: 'processing',
    }

    const { chunksSent, aborted } = await processBroadcastJobChunk(supabase, job, token, {
      maxChunks: 20,
    })
    processed.push({ job_id: row.id, chunks: chunksSent, aborted })
  }

  return NextResponse.json({ success: true, data: { processed, at: nowIso } })
}
