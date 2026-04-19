import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ serviceId: string; bookingServiceId: string }> }

/**
 * GET 公開スロット一覧（空きのみ、将来開始分）
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId, bookingServiceId } = await params
  const admin = createSupabaseAdminClient()

  const { data: svc } = await admin
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()

  if (!svc || svc.service_type !== 'line') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: bs } = await admin
    .from('line_messaging_booking_services')
    .select('id')
    .eq('id', bookingServiceId)
    .eq('service_id', serviceId)
    .eq('is_active', true)
    .maybeSingle()

  if (!bs) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const from = req.nextUrl.searchParams.get('from')?.trim()
  const fromIso = from ? new Date(from).toISOString() : new Date().toISOString()

  const { data, error } = await admin
    .from('line_messaging_booking_slots')
    .select('id, starts_at, ends_at, capacity, booked_count')
    .eq('booking_service_id', bookingServiceId)
    .gte('starts_at', fromIso)
    .order('starts_at', { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const available = (data ?? []).filter((s) => s.booked_count < s.capacity)
  return NextResponse.json({ success: true, data: available })
}
