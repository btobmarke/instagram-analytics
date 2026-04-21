import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type SalesHourlySlotRow = {
  id: string
  slot_label: string
  session_start_time: string | null
  session_end_time: string | null
  total_amount_with_tax: number | null
  total_amount_without_tax: number | null
  business_hours_minutes: number | null
  is_rest_break: boolean
  memo: string | null
}

type SalesDayRow = {
  id: string
  service_id: string
  sales_date: string
  session_label: string
  data_source: 'pos' | 'manual'
  memo: string | null
  sales_hourly_slots: SalesHourlySlotRow[] | null
}

// GET /api/services/:serviceId/sales/records
// クエリ: from, to — sales_days を期間で取得し、子の sales_hourly_slots を含める
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
  const to = searchParams.get('to')

  let query = supabase
    .from('sales_days')
    .select(`
      id,
      service_id,
      sales_date,
      session_label,
      data_source,
      memo,
      sales_hourly_slots (
        id,
        slot_label,
        session_start_time,
        session_end_time,
        total_amount_with_tax,
        total_amount_without_tax,
        business_hours_minutes,
        is_rest_break,
        memo
      )
    `)
    .eq('service_id', serviceId)
    .order('sales_date', { ascending: false })
    .order('session_label', { ascending: true })

  if (from) query = query.gte('sales_date', from)
  if (to) query = query.lte('sales_date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  const rows = (data ?? []) as SalesDayRow[]
  for (const day of rows) {
    const slots = day.sales_hourly_slots ?? []
    slots.sort((a, b) => a.slot_label.localeCompare(b.slot_label, 'ja'))
  }

  return NextResponse.json({ success: true, data: rows })
}

// POST /api/services/:serviceId/sales/records
// 親 sales_days（日＋締め）を用意し、子 sales_hourly_slots に1行追加
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
    sales_day_id: existingSalesDayId,
    sales_date,
    session_label = 'all',
    slot_label = 'all',
    session_start_time,
    session_end_time,
    data_source = 'pos',
    total_amount_with_tax,
    total_amount_without_tax,
    business_hours_minutes,
    memo,
    is_rest_break = false,
  } = body

  if (!String(slot_label).trim()) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: '時間帯ラベルは必須です' } }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  let salesDayId: string | undefined

  if (existingSalesDayId) {
    const { data: dayById, error: idErr } = await admin
      .from('sales_days')
      .select('id')
      .eq('id', existingSalesDayId)
      .eq('service_id', serviceId)
      .maybeSingle()

    if (idErr) return NextResponse.json({ success: false, error: idErr.message }, { status: 500 })
    if (!dayById) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '売上日（親）が見つかりません' } }, { status: 404 })
    }
    salesDayId = dayById.id
  } else {
    if (!sales_date) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: '売上日は必須です' } }, { status: 400 })
    }
    if (!String(session_label).trim()) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION', message: '締め区分は必須です' } }, { status: 400 })
    }

    const { data: existingDay, error: findErr } = await admin
      .from('sales_days')
      .select('id')
      .eq('service_id', serviceId)
      .eq('sales_date', sales_date)
      .eq('session_label', String(session_label).trim())
      .maybeSingle()

    if (findErr) return NextResponse.json({ success: false, error: findErr.message }, { status: 500 })

    salesDayId = existingDay?.id as string | undefined
    if (!salesDayId) {
      const { data: createdDay, error: dayErr } = await admin
        .from('sales_days')
        .insert({
          service_id: serviceId,
          sales_date,
          session_label: String(session_label).trim(),
          data_source,
          memo: null,
        })
        .select('id')
        .single()

      if (dayErr) {
        if (dayErr.code === '23505') {
          return NextResponse.json(
            { success: false, error: { code: 'DUPLICATE', message: '同じ日・締め区分の売上（親）が既に存在します' } },
            { status: 409 }
          )
        }
        return NextResponse.json({ success: false, error: dayErr.message }, { status: 500 })
      }
      salesDayId = createdDay.id
    }
  }

  const { data: slot, error: slotErr } = await admin
    .from('sales_hourly_slots')
    .insert({
      sales_day_id: salesDayId,
      slot_label: String(slot_label).trim(),
      session_start_time: session_start_time ?? null,
      session_end_time: session_end_time ?? null,
      total_amount_with_tax: total_amount_with_tax ?? null,
      total_amount_without_tax: total_amount_without_tax ?? null,
      business_hours_minutes: business_hours_minutes ?? null,
      is_rest_break: Boolean(is_rest_break),
      memo: memo ?? null,
    })
    .select()
    .single()

  if (slotErr) {
    if (slotErr.code === '23505') {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: '同じ日・締め内に同じ時間帯ラベルが既に存在します' } },
        { status: 409 }
      )
    }
    return NextResponse.json({ success: false, error: slotErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: { sales_day_id: salesDayId, slot } }, { status: 201 })
}

// DELETE /api/services/:serviceId/sales/records?id=日次UUID — 親ごと削除（子・注文も CASCADE）
// DELETE ?slot_id=時間帯UUID — 時間帯1行のみ削除。子が0件になったら親も削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const dayId = sp.get('id')
  const slotId = sp.get('slot_id')

  if (!dayId && !slotId) {
    return NextResponse.json({ success: false, error: 'id（日次）または slot_id（時間帯）のいずれかが必須です' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  if (dayId) {
    const { error } = await admin
      .from('sales_days')
      .delete()
      .eq('id', dayId)
      .eq('service_id', serviceId)

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const { data: slotRow, error: slotFetchErr } = await admin
    .from('sales_hourly_slots')
    .select('id, sales_day_id')
    .eq('id', slotId!)
    .maybeSingle()

  if (slotFetchErr) return NextResponse.json({ success: false, error: slotFetchErr.message }, { status: 500 })
  if (!slotRow) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '時間帯が見つかりません' } }, { status: 404 })

  const { data: dayRow, error: dayFetchErr } = await admin
    .from('sales_days')
    .select('id')
    .eq('id', slotRow.sales_day_id)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (dayFetchErr) return NextResponse.json({ success: false, error: dayFetchErr.message }, { status: 500 })
  if (!dayRow) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '売上日が見つかりません' } }, { status: 404 })

  const { error: delSlotErr } = await admin
    .from('sales_hourly_slots')
    .delete()
    .eq('id', slotId!)

  if (delSlotErr) return NextResponse.json({ success: false, error: delSlotErr.message }, { status: 500 })

  const { count, error: countErr } = await admin
    .from('sales_hourly_slots')
    .select('id', { count: 'exact', head: true })
    .eq('sales_day_id', slotRow.sales_day_id)

  if (countErr) return NextResponse.json({ success: false, error: countErr.message }, { status: 500 })
  if ((count ?? 0) === 0) {
    const { error: delDayErr } = await admin
      .from('sales_days')
      .delete()
      .eq('id', slotRow.sales_day_id)
      .eq('service_id', serviceId)
    if (delDayErr) return NextResponse.json({ success: false, error: delDayErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
