import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { buildOAuthUrl } from '@/lib/gbp/auth'
import { decrypt } from '@/lib/utils/crypto'

// GET /api/clients/:clientId/gbp/auth - OAuth開始（Google同意画面にリダイレクト）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // DBから認証情報を取得
  const admin = createSupabaseAdminClient()
  const { data: cred } = await admin
    .from('gbp_credentials')
    .select('oauth_client_id_enc, oauth_client_secret_enc')
    .eq('client_id', clientId)
    .single()

  if (!cred) {
    return NextResponse.json({
      error: 'GBP OAuth 設定が未登録です。クライアント設定画面で Client ID / Client Secret を登録してください。',
    }, { status: 400 })
  }

  const oauthClientId = decrypt(cred.oauth_client_id_enc)

  // リダイレクトURIは環境変数（デプロイ先に依存するため）
  // 未設定の場合はリクエストURLから自動生成
  const redirectUri = process.env.GBP_REDIRECT_URI
    ?? new URL('/api/auth/gbp/callback', request.url).toString()

  // state にクライアントIDとユーザーIDを埋め込み
  const state = Buffer.from(JSON.stringify({ clientId, userId: user.id })).toString('base64url')

  const url = buildOAuthUrl({ clientId: oauthClientId, redirectUri, state })
  return NextResponse.redirect(url)
}

// DELETE /api/clients/:clientId/gbp/auth - 連携解除（refresh_tokenをクリア）
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('gbp_credentials')
    .update({
      refresh_token_enc:    null,
      auth_status:          'revoked',
      google_account_email: null,
      scopes:               null,
      updated_at:           new Date().toISOString(),
    })
    .eq('client_id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
