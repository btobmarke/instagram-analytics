import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { logMessagingEvent } from '@/lib/line/log-messaging-event'

type Params = { params: Promise<{ serviceId: string; bookingId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { serviceId, bookingId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: b } = await admin
    .from('line_messaging_bookings')
    .select('id, status, booking_slot_id, contact_id, line_user_id')
    .eq('id', bookingId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!b) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (b.status === 'cancelled') return NextResponse.json({ error: 'already_cancelled' }, { status: 409 })

  const { error: u1 } = await admin
    .from('line_messaging_bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (u1) return NextResponse.json({ error: u1.message }, { status: 500 })

  const { error: u2 } = await admin.rpc('line_messaging_release_booking_slot', {
    p_slot_id: b.booking_slot_id,
  })

  if (u2) {
    console.error('[booking cancel] release slot', u2.message)
  }

  await logMessagingEvent(admin, {
    service_id: serviceId,
    contact_id: b.contact_id,
    line_user_id: b.line_user_id,
    trigger_type: 'booking.cancelled',
    payload: { booking_id: bookingId },
  })

  return NextResponse.json({ success: true })
}
