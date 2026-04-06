import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { authenticateLpRequest } from '@/lib/lp-auth'

function createAnonSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const HeartbeatSchema = z.object({
  sessionId: z.string().uuid(),
  occurredAt: z.string().optional(),
})

/**
 * POST /api/public/lp/session/heartbeat
 * セッションハートビート API
 *
 * - セッションの last_activity_at を更新して継続扱いにする
 */
export async function POST(request: NextRequest) {
  const supabase = createAnonSupabaseClient()

  const auth = await authenticateLpRequest(request, supabase)
  if (auth.error) return auth.error

  const lpSite = auth.lpSite

  const body = await request.json().catch(() => null)
  const parsed = HeartbeatSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } },
      { status: 400 }
    )
  }

  const { sessionId, occurredAt } = parsed.data
  const now = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString()

  // セッションが対象 lpSite に属するか確認
  const { data: sessionRaw } = await supabase
    .from('lp_sessions')
    .select('id, ended_at, lp_users!inner(lp_site_id)')
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

  if (session.ended_at) {
    return NextResponse.json(
      { success: false, error: { code: 'SESSION_ENDED', message: 'セッションは終了しています' } },
      { status: 409 }
    )
  }

  await supabase
    .from('lp_sessions')
    .update({ last_activity_at: now })
    .eq('id', sessionId)

  return NextResponse.json({ success: true, data: null })
}
