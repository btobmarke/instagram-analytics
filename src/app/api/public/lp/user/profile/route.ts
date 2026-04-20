import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { authenticateLpRequest } from '@/lib/lp-auth'

const MAX_PROFILE_KEYS = 40
const MAX_KEY_LEN = 80
const MAX_STRING_VALUE_LEN = 2000

const profileValueSchema = z.union([
  z.string().max(MAX_STRING_VALUE_LEN),
  z.number().finite(),
  z.boolean(),
])

const UserProfileSchema = z.object({
  lpCode: z.string().min(1),
  anonymousUserKey: z.string().min(1),
  /** フラットなキー値。既存の form_profile_json とマージ（同じキーは上書き） */
  profile: z.record(profileValueSchema),
})

function normalizeProfile(
  raw: Record<string, string | number | boolean>
): Record<string, string | number | boolean> | null {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim()
    if (!key || key.length > MAX_KEY_LEN) continue
    out[key] = v
    if (Object.keys(out).length > MAX_PROFILE_KEYS) return null
  }
  return Object.keys(out).length === 0 ? null : out
}

/**
 * POST /api/public/lp/user/profile
 * 匿名ユーザーにフォーム入力などの属性を保存（マージ）
 */
export async function POST(request: NextRequest) {
  const supabase = createSupabaseAdminClient()

  const auth = await authenticateLpRequest(request, supabase)
  if (auth.error) return auth.error

  const lpSite = auth.lpSite

  const body = await request.json().catch(() => null)
  const parsed = UserProfileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } },
      { status: 400 }
    )
  }

  const { anonymousUserKey, profile } = parsed.data
  const normalized = normalizeProfile(profile)
  if (!normalized || Object.keys(normalized).length === 0) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'profile が空か、キー数・長さの上限を超えています' } },
      { status: 400 }
    )
  }

  const { data: lpUser, error: findError } = await supabase
    .from('lp_users')
    .select('id, form_profile_json')
    .eq('lp_site_id', lpSite.id)
    .eq('anonymous_user_key', anonymousUserKey)
    .single()

  if (findError || !lpUser) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } },
      { status: 404 }
    )
  }

  const existing =
    lpUser.form_profile_json &&
    typeof lpUser.form_profile_json === 'object' &&
    !Array.isArray(lpUser.form_profile_json)
      ? (lpUser.form_profile_json as Record<string, unknown>)
      : {}

  const merged: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(existing)) {
    const t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') {
      merged[k] = v as string | number | boolean
    }
  }
  Object.assign(merged, normalized)
  if (Object.keys(merged).length > MAX_PROFILE_KEYS) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'マージ後のキー数が上限を超えています' } },
      { status: 400 }
    )
  }

  const { error: updateError } = await supabase
    .from('lp_users')
    .update({ form_profile_json: merged })
    .eq('id', lpUser.id)

  if (updateError) {
    console.error('[LP-SDK] user/profile  ✗ DB error', updateError)
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: 'プロフィールの保存に失敗しました' } },
      { status: 500 }
    )
  }

  console.log(`[LP-SDK] user/profile  lpCode=${lpSite.lp_code} keys=${Object.keys(normalized).join(',')}`)

  return NextResponse.json({ success: true, data: null })
}
