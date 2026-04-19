import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { logMessagingEvent } from '@/lib/line/log-messaging-event'

type Params = { params: Promise<{ serviceId: string }> }

const BodySchema = z.object({
  slot_id: z.string().uuid(),
  line_user_id: z.string().min(1).max(128).optional(),
  guest_name: z.string().max(200).optional(),
  guest_phone: z.string().max(50).optional(),
  note: z.string().max(2000).optional(),
})

/**
 * POST 予約（公開・認証なし）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: svc } = await admin
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()

  if (!svc || svc.service_type !== 'line') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: slot } = await admin
    .from('line_messaging_booking_slots')
    .select('id, booking_service_id')
    .eq('id', parsed.data.slot_id)
    .maybeSingle()

  if (!slot) return NextResponse.json({ error: 'invalid_slot' }, { status: 404 })

  const { data: bs } = await admin
    .from('line_messaging_booking_services')
    .select('id')
    .eq('id', slot.booking_service_id)
    .eq('service_id', serviceId)
    .eq('is_active', true)
    .maybeSingle()

  if (!bs) return NextResponse.json({ error: 'invalid_slot' }, { status: 404 })

  let contactId: string | null = null
  const lineUid = parsed.data.line_user_id?.trim() ?? ''
  if (lineUid) {
    const { data: c } = await admin
      .from('line_messaging_contacts')
      .select('id')
      .eq('service_id', serviceId)
      .eq('line_user_id', lineUid)
      .maybeSingle()
    contactId = c?.id ?? null
  }

  const { data: bookingId, error: rpcErr } = await admin.rpc('line_messaging_try_book_slot', {
    p_slot_id: parsed.data.slot_id,
    p_service_id: serviceId,
    p_contact_id: contactId,
    p_line_user_id: lineUid || null,
    p_guest_name: parsed.data.guest_name?.trim() ?? null,
    p_guest_phone: parsed.data.guest_phone?.trim() ?? null,
    p_note: parsed.data.note?.trim() ?? null,
  })

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 })
  }
  if (!bookingId) {
    return NextResponse.json({ error: 'slot_full_or_unavailable' }, { status: 409 })
  }

  await logMessagingEvent(admin, {
    service_id: serviceId,
    contact_id: contactId,
    line_user_id: lineUid || null,
    trigger_type: 'booking.confirmed',
    payload: { booking_id: bookingId, slot_id: parsed.data.slot_id },
  })

  return NextResponse.json({ success: true, data: { booking_id: bookingId } })
}
