import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET /api/services/:serviceId - サービス詳細取得
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { data: service, error } = await supabase
    .from('services')
    .select(`
      id, project_id, service_type, service_name, display_order, is_active, created_at, updated_at,
      projects!inner(id, project_name, client_id, clients!inner(id, client_name))
    `)
    .eq('id', serviceId)
    .single()

  if (error || !service) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'サービスが見つかりません' } }, { status: 404 })
  }

  const serviceData = service as Record<string, unknown>
  const project = serviceData.projects as Record<string, unknown>
  const client = project?.clients as Record<string, unknown>

  // 種別ごとの追加情報を取得
  let typeConfig = null
  if (service.service_type === 'lp') {
    const { data: lpSite } = await supabase
      .from('lp_sites')
      .select('id, lp_code, lp_name, target_url, session_timeout_minutes, is_active')
      .eq('service_id', serviceId)
      .single()
    typeConfig = lpSite

    const { data: integrations } = await supabase
      .from('service_integrations')
      .select('integration_type, external_project_id, status, last_synced_at')
      .eq('service_id', serviceId)
    typeConfig = { ...typeConfig, integrations: integrations ?? [] }
  }

  if (service.service_type === 'instagram') {
    // ig_accounts に service_id を直接持つようになったので JOIN 不要
    const { data: igAccount } = await supabase
      .from('ig_accounts')
      .select('id, username, account_name, status')
      .eq('service_id', serviceId)
      .single()

    typeConfig = igAccount
      ? {
          ig_account_ref_id: igAccount.id,
          username: igAccount.username,
          display_name: igAccount.account_name,
          status: igAccount.status,
        }
      : null
  }

  return NextResponse.json({
    success: true,
    data: {
      id: service.id,
      project_id: service.project_id,
      service_type: service.service_type,
      service_name: service.service_name,
      display_order: service.display_order,
      is_active: service.is_active,
      created_at: service.created_at,
      updated_at: service.updated_at,
      project: { id: project?.id, project_name: project?.project_name },
      client: { id: client?.id, client_name: client?.client_name },
      type_config: typeConfig,
    },
  })
}

// DELETE /api/services/:serviceId - サービスを論理削除
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  // サービス存在確認
  const { data: service } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .is('deleted_at', null)
    .single()

  if (!service) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'サービスが見つかりません' } }, { status: 404 })
  }

  const admin = createSupabaseAdminClient()
  const now = new Date().toISOString()

  // 1. Instagram: ig_accounts.service_id を NULL にして再利用可能にする
  if (service.service_type === 'instagram') {
    const { error: igErr } = await admin
      .from('ig_accounts')
      .update({ service_id: null })
      .eq('service_id', serviceId)
    if (igErr) console.error('[DELETE /api/services] ig_accounts unlock error', igErr)
  }

  // 2. LP: lp_sites を非アクティブにする
  if (service.service_type === 'lp') {
    const { error: lpErr } = await admin
      .from('lp_sites')
      .update({ is_active: false })
      .eq('service_id', serviceId)
    if (lpErr) console.error('[DELETE /api/services] lp_sites deactivate error', lpErr)
  }

  // 3. 外部連携設定を削除
  await admin
    .from('service_integrations')
    .delete()
    .eq('service_id', serviceId)

  // 4. services を論理削除
  const { error: deleteErr } = await admin
    .from('services')
    .update({ deleted_at: now, is_active: false })
    .eq('id', serviceId)

  if (deleteErr) {
    console.error('[DELETE /api/services] soft delete error', deleteErr)
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: '削除に失敗しました' } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// PATCH /api/services/:serviceId - Instagram アカウントをサービスに紐づける
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { ig_account_ref_id } = body

  if (!ig_account_ref_id) {
    return NextResponse.json({ success: false, error: 'ig_account_ref_id は必須です' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  // ig_accounts.service_id を更新するだけでよい
  const { data, error } = await admin
    .from('ig_accounts')
    .update({ service_id: serviceId })
    .eq('id', ig_account_ref_id)
    .select('id, username, account_name, status, service_id')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}
