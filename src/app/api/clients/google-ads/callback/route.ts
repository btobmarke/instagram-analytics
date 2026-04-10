import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/utils/crypto'
import { exchangeCodeForTokens } from '@/lib/google-ads/oauth'

// Google Ads OAuth コールバック
// GET /api/clients/google-ads/callback?code=...&state=...
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/auth-error?error=${encodeURIComponent(errorParam)}`, request.url)
    )
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/auth-error?error=missing_params', request.url))
  }

  let clientId: string
  let userId: string
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString()) as {
      clientId?: string
      userId?: string
    }
    clientId = parsed.clientId ?? ''
    userId = parsed.userId ?? ''
    if (!clientId || !userId) throw new Error('invalid state')
  } catch {
    return NextResponse.redirect(new URL('/auth-error?error=invalid_state', request.url))
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== userId) {
    return NextResponse.redirect(new URL('/auth-error?error=session_mismatch', request.url))
  }

  const admin = createSupabaseAdminClient()
  const { data: cred } = await admin
    .from('client_google_ads_credentials')
    .select('oauth_client_id_enc, oauth_client_secret_enc')
    .eq('client_id', clientId)
    .single()

  if (!cred) {
    return NextResponse.redirect(new URL('/auth-error?error=credential_not_found', request.url))
  }

  const oauthClientId = decrypt(cred.oauth_client_id_enc)
  const oauthClientSecret = decrypt(cred.oauth_client_secret_enc)
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI
    ?? new URL('/api/clients/google-ads/callback', request.url).toString()

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      redirectUri,
    })

    if (!tokens.refresh_token) {
      return NextResponse.redirect(new URL('/auth-error?error=no_refresh_token', request.url))
    }

    let email: string | null = null
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
        email = payload.email ?? null
      } catch {
        // ignore
      }
    }

    const { error: updateError } = await admin
      .from('client_google_ads_credentials')
      .update({
        refresh_token_enc: encrypt(tokens.refresh_token),
        scopes: tokens.scope ? [tokens.scope] : null,
        auth_status: 'active',
        google_account_email: email,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('client_id', clientId)

    if (updateError) {
      console.error('[Google Ads callback] update error:', updateError)
      return NextResponse.redirect(new URL('/auth-error?error=db_error', request.url))
    }

    return NextResponse.redirect(new URL(`/clients/${clientId}?google_ads_connected=1`, request.url))
  } catch (err) {
    console.error('[Google Ads callback] error:', err)
    const msg = err instanceof Error ? err.message : 'unknown_error'
    return NextResponse.redirect(
      new URL(`/auth-error?error=${encodeURIComponent(msg)}`, request.url)
    )
  }
}

