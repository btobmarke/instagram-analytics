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

const PageViewSchema = z.object({
  lpCode: z.string().min(1),
  anonymousUserKey: z.string().min(1),
  sessionId: z.string().uuid(),
  occurredAt: z.string().optional(),
  pageUrl: z.string().max(1000).optional(),
  pageTitle: z.string().max(500).optional(),
  scrollPercentMax: z.number().int().min(0).max(100).optional(),
  staySeconds: z.number().min(0).optional(),
})

/**
 * POST /api/public/lp/page-view
 * ページ閲覧送信 API
 *
 * - lp_page_views に INSERT
 * - lp_sessions の last_activity_at 更新
 */
export async function POST(request: NextRequest) {
  const supabase = createAnonSupabaseClient()

  const auth = await authenticateLpRequest(request, supabase)
  if (auth.error) return auth.error

  const lpSite = auth.lpSite

  const body = await request.json().catch(() => null)
  const parsed = PageViewSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } },
      { status: 400 }
    )
  }

  const { anonymousUserKey, sessionId, occurredAt, pageUrl, pageTitle, scrollPercentMax, staySeconds } = parsed.data

  // セッション確認（lpSite に紐づくユーザーのセッションか）
  const { data: session } = await supabase
    .from('lp_sessions')
    .select('id, lp_user_id, lp_users!inner(id, anonymous_key, lp_site_id)')
    .eq('id', sessionId)
    .single()

  const sessionData = session as Record<string, unknown> | null
  const sessionUser = sessionData?.lp_users as Record<string, unknown> | null

  if (
    !session ||
    sessionUser?.anonymous_key !== anonymousUserKey ||
    sessionUser?.lp_site_id !== lpSite.id
  ) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'セッションが見つかりません' } },
      { status: 404 }
    )
  }

  const now = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString()

  // ページビュー保存
  const { error: pvError } = await supabase.from('lp_page_views').insert({
    lp_session_id: sessionId,
    lp_site_id: lpSite.id,
    occurred_at: now,
    page_url: pageUrl ?? '',
    page_title: pageTitle ?? null,
    scroll_percent_max: scrollPercentMax ?? null,
    stay_seconds: staySeconds ?? null,
  })

  if (pvError) {
    console.error('[POST /api/public/lp/page-view] insert error', pvError)
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: 'ページビュー保存に失敗しました' } },
      { status: 500 }
    )
  }

  // セッション最終操作時刻更新
  await supabase
    .from('lp_sessions')
    .update({ last_activity_at: now })
    .eq('id', sessionId)

  return NextResponse.json({ success: true, data: null })
}
