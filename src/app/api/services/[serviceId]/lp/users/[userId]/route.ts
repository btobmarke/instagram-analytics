import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * GET /api/services/:serviceId/lp/users/:userId
 * LP ユーザー詳細取得 API
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string; userId: string }> }
) {
  const { serviceId, userId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })
  }

  // LP Site 確認
  const { data: lpSite } = await supabase
    .from('lp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()

  if (!lpSite) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'LPサービスが見つかりません' } }, { status: 404 })
  }

  // ユーザー取得
  const { data: lpUser, error: userError } = await supabase
    .from('lp_users')
    .select('id, anonymous_user_key, first_visited_at, last_visited_at, visit_count, total_intent_score, user_temperature, form_profile_json')
    .eq('id', userId)
    .eq('lp_site_id', lpSite.id)
    .single()

  if (userError || !lpUser) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } }, { status: 404 })
  }

  // セッション一覧取得（最新20件）
  const { data: sessions } = await supabase
    .from('lp_sessions')
    .select('id, started_at, ended_at, duration_seconds, session_intent_score, referrer_source, landing_page_url, exit_page_url')
    .eq('lp_user_id', userId)
    .order('started_at', { ascending: false })
    .limit(20)

  return NextResponse.json({
    success: true,
    data: {
      userId: lpUser.id,
      anonymousKey: lpUser.anonymous_user_key,
      firstVisitedAt: lpUser.first_visited_at,
      lastVisitedAt: lpUser.last_visited_at,
      visitCount: lpUser.visit_count,
      totalIntentScore: lpUser.total_intent_score,
      userTemperature: lpUser.user_temperature, // 'HOT' | 'COLD'
      formProfile:
        lpUser.form_profile_json &&
        typeof lpUser.form_profile_json === 'object' &&
        !Array.isArray(lpUser.form_profile_json)
          ? (lpUser.form_profile_json as Record<string, unknown>)
          : {},
      sessions: (sessions ?? []).map(s => ({
        sessionId: s.id,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        durationSeconds: s.duration_seconds,
        sessionIntentScore: s.session_intent_score,
        referrerSource: s.referrer_source,
        landingPageUrl: s.landing_page_url,
        exitPageUrl: s.exit_page_url,
      })),
    },
  })
}
