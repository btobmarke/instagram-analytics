import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * GET /api/services/:serviceId/lp/sessions/:sessionId
 * LP セッション詳細取得 API
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string; sessionId: string }> }
) {
  const { serviceId, sessionId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })
  }

  const { data: lpSite } = await supabase
    .from('lp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()

  if (!lpSite) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'LPサービスが見つかりません' } }, { status: 404 })
  }

  // セッション取得
  const { data: session, error: sessionError } = await supabase
    .from('lp_sessions')
    .select(
      'id, lp_user_id, started_at, ended_at, duration_seconds, session_intent_score, interaction_count, referrer_source, landing_page_url, exit_page_url, user_agent, device_category',
    )
    .eq('id', sessionId)
    .eq('lp_site_id', lpSite.id)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'セッションが見つかりません' } }, { status: 404 })
  }

  // ページビュー履歴
  const { data: pageViews } = await supabase
    .from('lp_page_views')
    .select('id, occurred_at, page_url, page_title, scroll_percent_max, stay_seconds')
    .eq('lp_session_id', sessionId)
    .order('occurred_at', { ascending: true })

  // イベントログ
  const { data: eventLogs } = await supabase
    .from('lp_event_logs')
    .select('id, occurred_at, raw_event_id, event_name_snapshot, intent_score_snapshot, page_url, scroll_percent, meta_json')
    .eq('lp_session_id', sessionId)
    .order('occurred_at', { ascending: true })

  // 行動タイムライン（ページビューとイベントログをマージ、時系列ソート）
  type TimelineItem = {
    type: 'page_view' | 'event'
    occurredAt: string
    [key: string]: unknown
  }

  const timeline: TimelineItem[] = [
    ...(pageViews ?? []).map(pv => ({
      type: 'page_view' as const,
      occurredAt: pv.occurred_at,
      pageUrl: pv.page_url,
      pageTitle: pv.page_title,
      scrollPercentMax: pv.scroll_percent_max,
      staySeconds: pv.stay_seconds,
    })),
    ...(eventLogs ?? []).map(el => ({
      type: 'event' as const,
      occurredAt: el.occurred_at,
      eventId: el.raw_event_id,
      eventName: el.event_name_snapshot,
      intentScore: el.intent_score_snapshot,
      pageUrl: el.page_url,
      scrollPercent: el.scroll_percent,
      meta: el.meta_json,
    })),
  ].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())

  return NextResponse.json({
    success: true,
    data: {
      sessionId: session.id,
      userId: session.lp_user_id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      durationSeconds: session.duration_seconds,
      sessionIntentScore: session.session_intent_score,
      interactionCount: session.interaction_count,
      referrerSource: session.referrer_source,
      landingPageUrl: session.landing_page_url,
      exitPageUrl: session.exit_page_url,
      userAgent: session.user_agent ?? null,
      deviceCategory: session.device_category ?? 'unknown',
      pageViewCount: (pageViews ?? []).length,
      eventCount: (eventLogs ?? []).length,
      timeline,
    },
  })
}
