import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET /api/services/:serviceId/gbp/site - gbp_site 情報取得
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('gbp_sites')
    .select('*')
    .eq('service_id', serviceId)
    .single()

  if (error || !data) return NextResponse.json({ success: true, data: null })
  return NextResponse.json({ success: true, data })
}

// POST /api/services/:serviceId/gbp/site - gbp_site 登録（ロケーション選択後）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const { gbp_location_name, gbp_title, gbp_account_name } = body ?? {}

  if (!gbp_location_name) {
    return NextResponse.json({ success: false, error: 'gbp_location_name は必須です' }, { status: 400 })
  }

  // サービス存在確認
  const { data: service } = await supabase.from('services').select('id').eq('id', serviceId).single()
  if (!service) return NextResponse.json({ success: false, error: 'サービスが見つかりません' }, { status: 404 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('gbp_sites')
    .upsert({
      service_id:        serviceId,
      gbp_location_name,
      gbp_title:         gbp_title ?? null,
      gbp_account_name:  gbp_account_name ?? null,
      is_active:         true,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'service_id' })
    .select()
    .single()

  if (error) {
    console.error('[POST gbp/site]', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}

// PATCH /api/services/:serviceId/gbp/site - 更新
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const allowed = ['gbp_location_name', 'gbp_title', 'is_active']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('gbp_sites')
    .update(updates)
    .eq('service_id', serviceId)
    .select()
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}

// DELETE /api/services/:serviceId/gbp/site - ロケーション設定削除
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('gbp_sites').delete().eq('service_id', serviceId)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
