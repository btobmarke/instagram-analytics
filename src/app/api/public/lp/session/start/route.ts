import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { authenticateLpRequest } from '@/lib/lp-auth'
import { parseDeviceCategoryFromUserAgent } from '@/lib/lp-device-category'

const SessionStartSchema = z.object({
  lpCode: z.string().min(1),
  anonymousUserKey: z.string().min(1),
  startedAt: z.string().optional(),
  referrerSource: z.string().max(500).optional(),
  landingPageUrl: z.string().max(1000).optional(),
  userAgent: z.string().max(2000).optional(),
})

/**
 * POST /api/public/lp/session/start
 * セッション開始 API
 *
 * - 直近 session_timeout_minutes 以内にアクティブなセッションがあれば再利用
 * - それ以外は新規セッション作成
 */
export async function POST(request: NextRequest) {
  const supabase = createSupabaseAdminClient()

  const auth = await authenticateLpRequest(request, supabase)
  if (auth.error) return auth.error

  const lpSite = auth.lpSite

  const body = await request.json().catch(() => null)
  const parsed = SessionStartSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } },
      { status: 400 }
    )
  }

  const { anonymousUserKey, startedAt, referrerSource, landingPageUrl, userAgent: rawUa } = parsed.data
  const userAgent = rawUa && rawUa.length > 2000 ? rawUa.slice(0, 2000) : rawUa ?? null
  const deviceCategory = parseDeviceCategoryFromUserAgent(userAgent)

  console.log(`[LP-SDK] session/start  lpCode=${lpSite.lp_code} anonKey=${anonymousUserKey.slice(0,16)}... referrer=${referrerSource ?? 'direct'} url=${landingPageUrl ?? '-'}`)

  // ユーザー取得
  const { data: lpUser } = await supabase
    .from('lp_users')
    .select('id, last_visited_at, visit_count')
    .eq('lp_site_id', lpSite.id)
    .eq('anonymous_user_key', anonymousUserKey)
    .single()

  if (!lpUser) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } },
      { status: 404 }
    )
  }

  const now = startedAt ? new Date(startedAt) : new Date()
  const timeoutMs = lpSite.session_timeout_minutes * 60 * 1000

  // 直近のアクティブセッションを確認
  const { data: latestSession } = await supabase
    .from('lp_sessions')
    .select('id, last_activity_at, ended_at')
    .eq('lp_user_id', lpUser.id)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  if (latestSession) {
    const lastActivity = new Date(latestSession.last_activity_at)
    const elapsed = now.getTime() - lastActivity.getTime()

    if (elapsed < timeoutMs) {
      // セッション継続: last_activity_at を更新して返す
      console.log(`[LP-SDK] session/start  → セッション継続 sessionId=${latestSession.id}`)
      await supabase
        .from('lp_sessions')
        .update({ last_activity_at: now.toISOString() })
        .eq('id', latestSession.id)

      return NextResponse.json({
        success: true,
        data: { sessionId: latestSession.id, isNew: false },
      })
    }
  }

  // 新規セッション作成
  const { data: newSession, error: sessionError } = await supabase
    .from('lp_sessions')
    .insert({
      lp_user_id: lpUser.id,
      lp_site_id: lpSite.id,
      started_at: now.toISOString(),
      last_activity_at: now.toISOString(),
      referrer_source: referrerSource ?? null,
      landing_page_url: landingPageUrl ?? null,
      user_agent: userAgent,
      device_category: deviceCategory,
    })
    .select('id')
    .single()

  if (sessionError || !newSession) {
    console.error('[POST /api/public/lp/session/start] insert error', sessionError)
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: 'セッション作成に失敗しました' } },
      { status: 500 }
    )
  }

  console.log(`[LP-SDK] session/start  → 新規セッション sessionId=${newSession.id}`)

  // ユーザーの visit_count / last_visited_at 更新
  await supabase
    .from('lp_users')
    .update({
      last_visited_at: now.toISOString(),
      visit_count: (lpUser.visit_count ?? 0) + 1,
    })
    .eq('id', lpUser.id)

  return NextResponse.json({
    success: true,
    data: { sessionId: newSession.id, isNew: true },
  })
}
