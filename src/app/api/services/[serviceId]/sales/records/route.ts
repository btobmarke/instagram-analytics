import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET /api/services/:serviceId/sales/records
// クエリパラメータ: from (YYYY-MM-DD), to (YYYY-MM-DD)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')

  let query = supabase
    .from('sales_records')
    .select('*')
    .eq('service_id', serviceId)
    .order('sales_date', { ascending: false })
    .order('session_label', { ascending: true })

  if (from) query = query.gte('sales_date', from)
  if (to)   query = query.lte('sales_date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data })
}

// POST /api/services/:serviceId/sales/records
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const body = await req.json()
  const {
    sales_date,
    session_label = 'all',
    session_start_time,
    session_end_time,
    data_source = 'pos',
    total_amount_with_tax,
    total_amount_without_tax,
    business_hours_minutes,
    memo,
  } = body

  if (!sales_date) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: '売上日は必須です' } }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('sales_records')
    .insert({
      service_id: serviceId,
      sales_date,
      session_label,
      session_start_time: session_start_time ?? null,
      session_end_time: session_end_time ?? null,
      data_source,
      total_amount_with_tax: total_amount_with_tax ?? null,
      total_amount_without_tax: total_amount_without_tax ?? null,
      business_hours_minutes: business_hours_minutes ?? null,
      memo: memo ?? null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: '同じ日・締め区分の売上データが既に存在します' } },
        { status: 409 }
      )
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}

// DELETE /api/services/:serviceId/sales/records?id=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const recordId = new URL(req.url).searchParams.get('id')
  if (!recordId) return NextResponse.json({ success: false, error: 'id は必須です' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('sales_records')
    .delete()
    .eq('id', recordId)
    .eq('service_id', serviceId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
