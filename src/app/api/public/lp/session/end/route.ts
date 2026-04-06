import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { authenticateLpRequest } from '@/lib/lp-auth'

const SessionEndSchema = z.object({
  sessionId: z.string().uuid(),
  occurredAt: z.string().optional(),
  exitPageUrl: z.string().max(1000).optional(),
  totalDurationSeconds: z.number().min(0).optional(),
})

/**
 * POST /api/public/lp/session/end
 * セッション終了 API
 *
 * - ended_at をセット
 * - exit_page_url、duration_seconds を更新
 */
export async function POST(request: NextRequest) {
  const supabase = createSupabaseAdminClient()

  const auth = await authenticateLpRequest(request, supabase)
  if (auth.error) return auth.error

  const lpSite = auth.lpSite

  // sendBeacon は text/plain で送るため text() → JSON.parse にフォールバック
  const body = await request.text().then(t => { try { return JSON.parse(t) } catch { return null } }).catch(() => null)
  const parsed = SessionEndSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } },
      { status: 400 }
    )
  }

  const { sessionId, occurredAt, exitPageUrl, totalDurationSeconds } = parsed.data

  console.log(`[LP-SDK] session/end  sessionId=${sessionId} exitUrl=${exitPageUrl ?? '-'}`)
  const now = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString()

  // セッション取得
  const { data: sessionRaw } = await supabase
    .from('lp_sessions')
    .select('id, started_at, ended_at, lp_users!inner(lp_site_id)')
    .eq('id', sessionId)
    .single()

  const session = sessionRaw as Record<string, unknown> | null
  const sessionUser = session?.lp_users as Record<string, unknown> | null

  if (!session || sessionUser?.lp_site_id !== lpSite.id) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'セッションが見つかりません' } },
      { status: 404 }
    )
  }

  // 既に終了していたら 409
  if (session.ended_at) {
    return NextResponse.json(
      { success: false, error: { code: 'SESSION_ENDED', message: 'セッションは既に終了しています' } },
      { status: 409 }
    )
  }

  // duration 計算
  let durationSeconds = totalDurationSeconds
  if (durationSeconds === undefined && session.started_at) {
    durationSeconds = Math.round(
      (new Date(now).getTime() - new Date(session.started_at as string).getTime()) / 1000
    )
  }

  await supabase
    .from('lp_sessions')
    .update({
      ended_at: now,
      last_activity_at: now,
      exit_page_url: exitPageUrl ?? null,
      duration_seconds: durationSeconds ?? null,
    })
    .eq('id', sessionId)

  console.log(`[LP-SDK] session/end  → 終了記録 duration=${durationSeconds ?? '?'}秒`)

  return NextResponse.json({ success: true, data: null })
}
