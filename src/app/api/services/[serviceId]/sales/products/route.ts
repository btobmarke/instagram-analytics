import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET /api/services/:serviceId/sales/products
// クエリパラメータ: active_only=true で is_active=true のみ取得
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const activeOnly = new URL(req.url).searchParams.get('active_only') === 'true'

  let query = supabase
    .from('product_master')
    .select('*')
    .eq('service_id', serviceId)
    .order('item_code', { ascending: true })

  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data })
}

// POST /api/services/:serviceId/sales/products
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
    item_code,
    item_name,
    unit_price_with_tax,
    unit_price_without_tax,
    tax_rate,
    cost_price,
    has_stock_management = false,
    stock_quantity,
    sales_start_date,
    sales_end_date,
  } = body

  if (!item_name) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: '商品名は必須です' } }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('product_master')
    .insert({
      service_id: serviceId,
      item_code: item_code ?? null,
      item_name,
      unit_price_with_tax: unit_price_with_tax ?? null,
      unit_price_without_tax: unit_price_without_tax ?? null,
      tax_rate: tax_rate ?? null,
      cost_price: cost_price ?? null,
      has_stock_management,
      stock_quantity: has_stock_management ? (stock_quantity ?? null) : null,
      sales_start_date: sales_start_date ?? null,
      sales_end_date: sales_end_date ?? null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: '同じ商品コードが既に存在します' } },
        { status: 409 }
      )
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}

// PATCH /api/services/:serviceId/sales/products?id=xxx
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const productId = new URL(req.url).searchParams.get('id')
  if (!productId) return NextResponse.json({ success: false, error: 'id は必須です' }, { status: 400 })

  const body = await req.json()
  const admin = createSupabaseAdminClient()

  const { data, error } = await admin
    .from('product_master')
    .update(body)
    .eq('id', productId)
    .eq('service_id', serviceId)
    .select()
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data })
}

// DELETE /api/services/:serviceId/sales/products?id=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const productId = new URL(req.url).searchParams.get('id')
  if (!productId) return NextResponse.json({ success: false, error: 'id は必須です' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('product_master')
    .update({ is_active: false })
    .eq('id', productId)
    .eq('service_id', serviceId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
