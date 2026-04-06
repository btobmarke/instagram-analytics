import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { authenticateLpRequest } from '@/lib/lp-auth'

const EventSchema = z.object({
  lpCode: z.string().min(1),
  anonymousUserKey: z.string().min(1),
  sessionId: z.string().uuid(),
  eventId: z.string().min(1).max(255),
  occurredAt: z.string().optional(),
  pageUrl: z.string().max(1000).optional(),
  scrollPercent: z.number().int().min(0).max(100).optional(),
  meta: z.record(z.unknown()).optional(),
})

/**
 * POST /api/public/lp/event
 * イベント送信 API
 *
 * 1. イベントルール取得
 * 2. lp_event_logs に INSERT
 * 3. lp_sessions の intent_score 更新
 * 4. lp_users の total_intent_score 更新、ホット/コールド再判定
 */
export async function POST(request: NextRequest) {
  const supabase = createSupabaseAdminClient()

  const auth = await authenticateLpRequest(request, supabase)
  if (auth.error) return auth.error

  const lpSite = auth.lpSite

  const body = await request.json().catch(() => null)
  const parsed = EventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } },
      { status: 400 }
    )
  }

  const { anonymousUserKey, sessionId, eventId, occurredAt, pageUrl, scrollPercent, meta } = parsed.data

  console.log(`[LP-SDK] event  lpCode=${lpSite.lp_code} eventId=${eventId} url=${pageUrl ?? '-'}`)

  // セッション確認
  const { data: sessionRaw } = await supabase
    .from('lp_sessions')
    .select('id, lp_user_id, session_intent_score, lp_users!inner(id, anonymous_user_key, lp_site_id, total_intent_score, user_temperature)')
    .eq('id', sessionId)
    .single()

  const session = sessionRaw as Record<string, unknown> | null
  const sessionUser = session?.lp_users as Record<string, unknown> | null

  if (
    !session ||
    sessionUser?.anonymous_user_key !== anonymousUserKey ||
    sessionUser?.lp_site_id !== lpSite.id
  ) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'セッションが見つかりません' } },
      { status: 404 }
    )
  }

  // イベントルール取得（is_active なもの）
  const { data: eventRule } = await supabase
    .from('lp_event_rules')
    .select('id, event_id, intent_score, intent_type, is_active')
    .eq('lp_site_id', lpSite.id)
    .eq('event_id', eventId)
    .eq('is_active', true)
    .single()

  const now = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString()
  const intentScore = eventRule?.intent_score ?? 0
  const userId = sessionUser?.id as string

  // イベントログ保存
  const { error: logError } = await supabase.from('lp_event_logs').insert({
    lp_site_id: lpSite.id,
    lp_user_id: userId,
    lp_session_id: sessionId,
    event_rule_id: eventRule?.id ?? null,
    raw_event_id: eventId,
    event_name_snapshot: eventRule ? (eventRule as Record<string, unknown>).event_name as string ?? null : null,
    intent_score_snapshot: intentScore,
    occurred_at: now,
    page_url: pageUrl ?? null,
    scroll_percent: scrollPercent ?? null,
    meta_json: meta ?? {},
  })

  if (logError) {
    console.error('[LP-SDK] event  ✗ DB error', logError)
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: 'イベントログ保存に失敗しました' } },
      { status: 500 }
    )
  }

  // セッション session_intent_score 更新
  const newSessionScore = ((session.session_intent_score as number) ?? 0) + intentScore
  await supabase
    .from('lp_sessions')
    .update({
      session_intent_score: newSessionScore,
      last_activity_at: now,
    })
    .eq('id', sessionId)

  // ユーザー total_intent_score 更新 + ホット/コールド再判定
  const newTotalScore = ((sessionUser?.total_intent_score as number) ?? 0) + intentScore
  // userId は上で定義済み

  // lp_scoring_settings を取得してしきい値を確認
  const { data: scoringSettings } = await supabase
    .from('lp_scoring_settings')
    .select('hot_threshold')
    .eq('lp_site_id', lpSite.id)
    .single()

  const hotThreshold = scoringSettings?.hot_threshold ?? 100
  const newTemperature = newTotalScore >= hotThreshold ? 'HOT' : 'COLD'

  await supabase
    .from('lp_users')
    .update({
      total_intent_score: newTotalScore,
      user_temperature: newTemperature,
      last_visited_at: now,
    })
    .eq('id', userId)

  console.log(`[LP-SDK] event  → score=${intentScore} sessionTotal=${newSessionScore} userTotal=${newTotalScore} temp=${newTemperature}`)

  return NextResponse.json({
    success: true,
    data: {
      intentScore,
      sessionIntentScore: newSessionScore,
      totalIntentScore: newTotalScore,
      userTemperature: newTemperature,
    },
  })
}
