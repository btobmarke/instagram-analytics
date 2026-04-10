import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('google_ads_service_configs')
    .select('*')
    .eq('service_id', serviceId)
    .single()

  return NextResponse.json({ success: true, data: data ?? null })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const customerId = (body?.customer_id ?? '').toString().trim().replace(/-/g, '')
  const accountName = (body?.account_name ?? '').toString().trim()
  const currencyCode = (body?.currency_code ?? 'JPY').toString().trim()
  const timeZone = (body?.time_zone ?? 'Asia/Tokyo').toString().trim()
  const collectKeywords = Boolean(body?.collect_keywords ?? false)
  const backfillDays = Number(body?.backfill_days ?? 30)
  const isActive = body?.is_active ?? true

  if (!/^\d{10}$/.test(customerId)) {
    return NextResponse.json({ error: 'customer_id はハイフンなし10桁で入力してください' }, { status: 400 })
  }
  if (!Number.isFinite(backfillDays) || backfillDays < 1 || backfillDays > 90) {
    return NextResponse.json({ error: 'backfill_days は 1〜90 の範囲で指定してください' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('google_ads_service_configs')
    .upsert({
      service_id: serviceId,
      customer_id: customerId,
      account_name: accountName || null,
      currency_code: currencyCode || 'JPY',
      time_zone: timeZone || 'Asia/Tokyo',
      collect_keywords: collectKeywords,
      backfill_days: backfillDays,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'service_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}

export async function PUT(req: NextRequest, ctx: Params) {
  // POST と同じ upsert 振る舞いでOK（フロントの意図を明確にするために別メソッドを用意）
  return POST(req, ctx)
}

