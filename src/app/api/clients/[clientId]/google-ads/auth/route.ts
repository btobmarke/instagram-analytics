import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/utils/crypto'
import { buildGoogleAdsOAuthUrl } from '@/lib/google-ads/oauth'

// GET /api/clients/:clientId/google-ads/auth - OAuth開始（Google同意画面にリダイレクト）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data: cred } = await admin
    .from('client_google_ads_credentials')
    .select('oauth_client_id_enc')
    .eq('client_id', clientId)
    .single()

  if (!cred) {
    return NextResponse.json(
      { error: 'Google Ads OAuth 設定が未登録です。クライアント設定画面で Client ID / Client Secret / MCC を登録してください。' },
      { status: 400 }
    )
  }

  const oauthClientId = decrypt(cred.oauth_client_id_enc)
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI
    ?? new URL('/api/clients/google-ads/callback', request.url).toString()

  const state = Buffer.from(JSON.stringify({ clientId, userId: user.id })).toString('base64url')
  const url = buildGoogleAdsOAuthUrl({ clientId: oauthClientId, redirectUri, state })
  return NextResponse.redirect(url)
}

