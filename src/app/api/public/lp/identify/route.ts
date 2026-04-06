import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { authenticateLpRequest } from '@/lib/lp-auth'

// anon キーで Supabase クライアントを生成（RLS: anon ロール）
function createAnonSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const IdentifySchema = z.object({
  lpCode: z.string().min(1),
  existingAnonymousKey: z.string().nullable().optional(),
  userAgent: z.string().max(1000).optional(),
  clientTimestamp: z.string().optional(),
})

/**
 * POST /api/public/lp/identify
 * 匿名ユーザー識別 API
 *
 * - 既存 anonymousKey がある → lp_users を検索し返す
 * - ない (または見つからない) → 新規 lp_user を INSERT し anon key を返す
 */
export async function POST(request: NextRequest) {
  const supabase = createAnonSupabaseClient()

  // APIキー認証
  const auth = await authenticateLpRequest(request, supabase)
  if (auth.error) return auth.error

  const lpSite = auth.lpSite

  const body = await request.json().catch(() => null)
  const parsed = IdentifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } },
      { status: 400 }
    )
  }

  const { existingAnonymousKey, userAgent } = parsed.data

  // 既存キーで検索
  if (existingAnonymousKey) {
    const { data: existingUser } = await supabase
      .from('lp_users')
      .select('id, anonymous_key, first_visited_at, last_visited_at, visit_count, total_intent_score, user_temperature')
      .eq('lp_site_id', lpSite.id)
      .eq('anonymous_key', existingAnonymousKey)
      .single()

    if (existingUser) {
      return NextResponse.json({
        success: true,
        data: {
          anonymousUserKey: existingUser.anonymous_key,
          lpUserId: existingUser.id,
          isNew: false,
        },
      })
    }
  }

  // 新規ユーザー作成
  const anonymousKey = `anon_${crypto.randomUUID().replace(/-/g, '')}`
  const now = new Date().toISOString()

  const { data: newUser, error: insertError } = await supabase
    .from('lp_users')
    .insert({
      lp_site_id: lpSite.id,
      anonymous_key: anonymousKey,
      user_agent: userAgent ?? null,
      first_visited_at: now,
      last_visited_at: now,
    })
    .select('id, anonymous_key')
    .single()

  if (insertError || !newUser) {
    console.error('[POST /api/public/lp/identify] insert error', insertError)
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: 'ユーザー作成に失敗しました' } },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    data: {
      anonymousUserKey: newUser.anonymous_key,
      lpUserId: newUser.id,
      isNew: true,
    },
  })
}
