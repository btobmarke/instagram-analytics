import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

async function assertSlotBelongsToService(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string,
  slotId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { data: slot, error: slotErr } = await supabase
    .from('sales_hourly_slots')
    .select('id, sales_day_id')
    .eq('id', slotId)
    .maybeSingle()

  if (slotErr) return { ok: false, status: 500, message: slotErr.message }
  if (!slot) return { ok: false, status: 404, message: '時間帯が見つかりません' }

  const { data: day, error: dayErr } = await supabase
    .from('sales_days')
    .select('service_id')
    .eq('id', slot.sales_day_id)
    .maybeSingle()

  if (dayErr) return { ok: false, status: 500, message: dayErr.message }
  if (!day || day.service_id !== serviceId) {
    return { ok: false, status: 404, message: '時間帯が見つかりません' }
  }
  return { ok: true }
}

// GET /api/services/:serviceId/sales/hourly-slots/:slotId/orders
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serviceId: string; slotId: string }> }
) {
  const { serviceId, slotId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const check = await assertSlotBelongsToService(supabase, serviceId, slotId)
  if (!check.ok) {
    return NextResponse.json({ success: false, error: check.message }, { status: check.status })
  }

  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (
        id, item_id, item_code, item_name, quantity,
        unit_price_with_tax, unit_price_without_tax, tax_rate,
        cost_price, discount_amount, created_at
      )
    `)
    .eq('sales_hourly_slot_id', slotId)
    .order('ordered_at', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data })
}

// POST /api/services/:serviceId/sales/hourly-slots/:slotId/orders
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string; slotId: string }> }
) {
  const { serviceId, slotId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const check = await assertSlotBelongsToService(supabase, serviceId, slotId)
  if (!check.ok) {
    return NextResponse.json({ success: false, error: check.message }, { status: check.status })
  }

  const body = await req.json()
  const {
    ordered_at,
    amount_with_tax,
    amount_without_tax,
    order_discount_amount = 0,
    total_discount_amount = 0,
    memo,
    items = [],
  } = body

  if (!ordered_at) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: '注文日時は必須です' } }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      sales_hourly_slot_id: slotId,
      ordered_at,
      amount_with_tax: amount_with_tax ?? null,
      amount_without_tax: amount_without_tax ?? null,
      order_discount_amount,
      total_discount_amount,
      memo: memo ?? null,
    })
    .select()
    .single()

  if (orderError) return NextResponse.json({ success: false, error: orderError.message }, { status: 500 })

  if (items.length > 0) {
    const itemRows = items.map((item: Record<string, unknown>) => ({
      order_id: order.id,
      item_id: item.item_id ?? null,
      item_code: item.item_code ?? null,
      item_name: item.item_name,
      quantity: item.quantity ?? 1,
      unit_price_with_tax: item.unit_price_with_tax ?? null,
      unit_price_without_tax: item.unit_price_without_tax ?? null,
      tax_rate: item.tax_rate ?? null,
      cost_price: item.cost_price ?? null,
      discount_amount: item.discount_amount ?? 0,
    }))

    const { error: itemsError } = await admin.from('order_items').insert(itemRows)
    if (itemsError) return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: order }, { status: 201 })
}
