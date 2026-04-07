import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/utils/crypto'

// GET /api/clients/:clientId/gbp/credential - 認証情報の取得（機密情報は返さない）
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('gbp_credentials')
    .select('id, client_id, auth_status, google_account_email, scopes, created_at, updated_at')
    .eq('client_id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ success: true, data: null })
  }

  return NextResponse.json({ success: true, data })
}

// POST /api/clients/:clientId/gbp/credential
// GBP OAuthクライアント情報を登録/更新（client_id, client_secret）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const oauthClientId     = body?.oauth_client_id?.trim()
  const oauthClientSecret = body?.oauth_client_secret?.trim()

  if (!oauthClientId || !oauthClientSecret) {
    return NextResponse.json({
      success: false,
      error: 'OAuth Client ID と Client Secret は必須です',
    }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  const { data, error } = await admin
    .from('gbp_credentials')
    .upsert({
      client_id:               clientId,
      oauth_client_id_enc:     encrypt(oauthClientId),
      oauth_client_secret_enc: encrypt(oauthClientSecret),
      // refresh_token はOAuth完了時に書き込むためここでは触らない
      // ただし新規作成時は auth_status = 'pending'
      auth_status:             'pending',
      updated_at:              new Date().toISOString(),
    }, { onConflict: 'client_id' })
    .select('id, client_id, auth_status, created_at, updated_at')
    .single()

  if (error) {
    console.error('[POST gbp/credential]', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}

// DELETE /api/clients/:clientId/gbp/credential - 認証情報を削除
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('gbp_credentials')
    .delete()
    .eq('client_id', clientId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
