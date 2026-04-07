import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAccessTokenFromCredential, type GbpCredentialRow } from '@/lib/gbp/auth'
import { listLocations } from '@/lib/gbp/api'

// GET /api/services/:serviceId/gbp/locations
// GoogleアカウントでアクセスできるGBPロケーション一覧を取得
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  // サービス → プロジェクト → クライアントID を辿る
  const { data: service } = await supabase
    .from('services')
    .select('id, projects!inner(id, client_id)')
    .eq('id', serviceId)
    .single()

  if (!service) return NextResponse.json({ success: false, error: 'サービスが見つかりません' }, { status: 404 })

  const clientId = (service as unknown as { projects: { client_id: string } }).projects.client_id

  // クライアントのOAuth認証情報を取得
  const { data: cred, error: credError } = await supabase
    .from('gbp_credentials')
    .select('*')
    .eq('client_id', clientId)
    .single()

  if (credError || !cred) {
    return NextResponse.json({
      success: false,
      error: 'GBP認証情報が見つかりません。先にGoogleアカウントと連携してください。'
    }, { status: 404 })
  }

  if (cred.auth_status !== 'active') {
    return NextResponse.json({
      success: false,
      error: 'GBP認証が無効です。再連携してください。'
    }, { status: 403 })
  }

  try {
    const accessToken = await getAccessTokenFromCredential(cred as GbpCredentialRow)
    const locations   = await listLocations(accessToken)
    return NextResponse.json({ success: true, data: locations })
  } catch (err) {
    const isAuthErr = (err as Error & { isAuthError?: boolean }).isAuthError
    if (isAuthErr) {
      // トークン失効 → auth_status を error に
      await supabase
        .from('gbp_credentials')
        .update({ auth_status: 'error' })
        .eq('client_id', clientId)
      return NextResponse.json({ success: false, error: '認証エラー：再連携が必要です' }, { status: 403 })
    }
    console.error('[GET gbp/locations]', err)
    return NextResponse.json({ success: false, error: 'ロケーション取得に失敗しました' }, { status: 500 })
  }
}
