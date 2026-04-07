import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/gbp/auth'
import { encrypt, decrypt } from '@/lib/utils/crypto'

// GBP OAuthコールバック
// GET /api/auth/gbp/callback?code=...&state=...
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  // Google側エラー（ユーザーが同意拒否など）
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/auth-error?error=${encodeURIComponent(errorParam)}`, request.url)
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/auth-error?error=missing_params', request.url))
  }

  // state からクライアントIDを復元
  let clientId: string
  let userId: string
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
    clientId = parsed.clientId
    userId   = parsed.userId
    if (!clientId || !userId) throw new Error('invalid state')
  } catch {
    return NextResponse.redirect(new URL('/auth-error?error=invalid_state', request.url))
  }

  // セッション確認
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== userId) {
    return NextResponse.redirect(new URL('/auth-error?error=session_mismatch', request.url))
  }

  // DBからOAuth client_id / client_secret を取得
  const admin = createSupabaseAdminClient()
  const { data: cred } = await admin
    .from('gbp_credentials')
    .select('oauth_client_id_enc, oauth_client_secret_enc')
    .eq('client_id', clientId)
    .single()

  if (!cred) {
    return NextResponse.redirect(new URL('/auth-error?error=credential_not_found', request.url))
  }

  const gbpClientId     = decrypt(cred.oauth_client_id_enc)
  const gbpClientSecret = decrypt(cred.oauth_client_secret_enc)

  // リダイレクトURI（OAuth開始時と同じ値を使用）
  const redirectUri = process.env.GBP_REDIRECT_URI
    ?? new URL('/api/auth/gbp/callback', request.url).toString()

  try {
    // 認可コード → トークン交換
    const tokens = await exchangeCodeForTokens({
      code,
      clientId:     gbpClientId,
      clientSecret: gbpClientSecret,
      redirectUri,
    })

    if (!tokens.refresh_token) {
      return NextResponse.redirect(new URL('/auth-error?error=no_refresh_token', request.url))
    }

    // メールアドレス取得（id_token から）
    let email: string | null = null
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
        email = payload.email ?? null
      } catch { /* ignore */ }
    }

    // gbp_credentials を更新（refresh_token + auth_status → active）
    const { error: updateError } = await admin
      .from('gbp_credentials')
      .update({
        refresh_token_enc:    encrypt(tokens.refresh_token),
        scopes:               tokens.scope,
        auth_status:          'active',
        google_account_email: email,
        updated_at:           new Date().toISOString(),
      })
      .eq('client_id', clientId)

    if (updateError) {
      console.error('[GBP callback] update error:', updateError)
      return NextResponse.redirect(new URL('/auth-error?error=db_error', request.url))
    }

    // 連携成功 → クライアント詳細ページにリダイレクト
    return NextResponse.redirect(new URL(`/clients/${clientId}?gbp_connected=1`, request.url))

  } catch (err) {
    console.error('[GBP callback] error:', err)
    const msg = err instanceof Error ? err.message : 'unknown_error'
    return NextResponse.redirect(
      new URL(`/auth-error?error=${encodeURIComponent(msg)}`, request.url)
    )
  }
}
