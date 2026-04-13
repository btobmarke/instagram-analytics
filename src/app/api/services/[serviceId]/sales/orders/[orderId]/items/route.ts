import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET /api/services/:serviceId/sales/orders/:orderId/items
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serviceId: string; orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data })
}

// POST /api/services/:serviceId/sales/orders/:orderId/items
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string; orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const body = await req.json()
  const {
    item_id,
    item_code,
    item_name,
    quantity = 1,
    unit_price_with_tax,
    unit_price_without_tax,
    tax_rate,
    cost_price,
    discount_amount = 0,
  } = body

  if (!item_name) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: '商品名は必須です' } }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('order_items')
    .insert({
      order_id: orderId,
      item_id: item_id ?? null,
      item_code: item_code ?? null,
      item_name,
      quantity,
      unit_price_with_tax: unit_price_with_tax ?? null,
      unit_price_without_tax: unit_price_without_tax ?? null,
      tax_rate: tax_rate ?? null,
      cost_price: cost_price ?? null,
      discount_amount,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data }, { status: 201 })
}

// DELETE /api/services/:serviceId/sales/orders/:orderId/items?id=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string; orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const itemId = new URL(req.url).searchParams.get('id')
  if (!itemId) return NextResponse.json({ success: false, error: 'id は必須です' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('order_items')
    .delete()
    .eq('id', itemId)
    .eq('order_id', orderId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
