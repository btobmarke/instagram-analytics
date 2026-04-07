import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ serviceId: string }> }

// GET: リワードカード一覧
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_oam_rewardcards')
    .select('*')
    .eq('service_id', serviceId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

// POST: リワードカード追加
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.rewardcard_id) {
    return NextResponse.json({ error: 'rewardcard_id は必須です' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_oam_rewardcards')
    .insert({
      service_id:    serviceId,
      rewardcard_id: body.rewardcard_id,
      name:          body.name ?? null,
      start_date:    body.start_date ?? null,
      is_active:     true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data }, { status: 201 })
}

// PATCH: リワードカード更新（id をクエリパラメータで指定）
export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const allowed = ['name', 'start_date', 'is_active']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_oam_rewardcards')
    .update(updates)
    .eq('id', id)
    .eq('service_id', serviceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}

// DELETE: リワードカード削除
export async function DELETE(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('line_oam_rewardcards')
    .delete()
    .eq('id', id)
    .eq('service_id', serviceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
