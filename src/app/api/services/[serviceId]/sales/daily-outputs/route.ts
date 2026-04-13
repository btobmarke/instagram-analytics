import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET /api/services/:serviceId/sales/daily-outputs?sales_id=xxx
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const salesId = new URL(req.url).searchParams.get('sales_id')
  if (!salesId) return NextResponse.json({ success: false, error: 'sales_id は必須です' }, { status: 400 })

  const { data, error } = await supabase
    .from('product_daily_outputs')
    .select('*')
    .eq('sales_id', salesId)
    .order('item_code', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data })
}

// POST /api/services/:serviceId/sales/daily-outputs
// items を配列で受け取り一括 upsert
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const body = await req.json()
  const { sales_id, items } = body

  if (!sales_id) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: 'sales_id は必須です' } }, { status: 400 })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: 'items は1件以上必要です' } }, { status: 400 })
  }

  const rows = items.map((item: Record<string, unknown>) => ({
    sales_id,
    item_id: item.item_id ?? null,
    item_code: item.item_code ?? null,
    item_name: item.item_name,
    quantity: item.quantity ?? 0,
    unit_price_with_tax: item.unit_price_with_tax ?? null,
    unit_price_without_tax: item.unit_price_without_tax ?? null,
    tax_rate: item.tax_rate ?? null,
    cost_price: item.cost_price ?? null,
  }))

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('product_daily_outputs')
    .upsert(rows, { onConflict: 'sales_id,item_id' })
    .select()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data }, { status: 201 })
}

// DELETE /api/services/:serviceId/sales/daily-outputs?id=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const outputId = new URL(req.url).searchParams.get('id')
  if (!outputId) return NextResponse.json({ success: false, error: 'id は必須です' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('product_daily_outputs')
    .delete()
    .eq('id', outputId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
