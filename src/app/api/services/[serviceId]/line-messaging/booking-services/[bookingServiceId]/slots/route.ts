import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; bookingServiceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, bookingServiceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: bs } = await admin
    .from('line_messaging_booking_services')
    .select('id')
    .eq('id', bookingServiceId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!bs) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data, error } = await admin
    .from('line_messaging_booking_slots')
    .select('*')
    .eq('booking_service_id', bookingServiceId)
    .order('starts_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  starts_at: z.string(),
  ends_at: z.string().optional(),
  capacity: z.number().int().min(1).max(100).optional(),
})

/**
 * POST 単一スロット、または POST body に generate を付けて一括生成
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId, bookingServiceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: bs, error: bErr } = await admin
    .from('line_messaging_booking_services')
    .select('*')
    .eq('id', bookingServiceId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (bErr || !bs) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = await req.json().catch(() => null)

  if (body?.generate && typeof body.generate === 'object') {
    const GenSchema = z.object({
      from: z.string(),
      to: z.string(),
      slot_minutes: z.number().int().min(5).max(240).optional(),
    })
    const g = GenSchema.safeParse(body.generate)
    if (!g.success) {
      return NextResponse.json(
        { error: 'validation_error', details: g.error.flatten() },
        { status: 422 },
      )
    }
    const fromMs = Date.parse(g.data.from)
    const toMs = Date.parse(g.data.to)
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) {
      return NextResponse.json({ error: 'invalid_range' }, { status: 422 })
    }

    const slotMin = g.data.slot_minutes ?? bs.duration_minutes
    const cap = bs.capacity_per_slot
    const rows: { booking_service_id: string; starts_at: string; ends_at: string; capacity: number }[] = []

    let t = fromMs
    while (t + slotMin * 60 * 1000 <= toMs) {
      const start = new Date(t).toISOString()
      const end = new Date(t + slotMin * 60 * 1000).toISOString()
      rows.push({
        booking_service_id: bookingServiceId,
        starts_at: start,
        ends_at: end,
        capacity: cap,
      })
      t += slotMin * 60 * 1000
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'no_slots_in_range' }, { status: 422 })
    }

    const { error: insErr } = await admin.from('line_messaging_booking_slots').insert(rows)
    if (insErr) {
      if (insErr.code === '23505') {
        return NextResponse.json({ error: 'overlap_or_duplicate_starts_at' }, { status: 409 })
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: { created: rows.length } })
  }

  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const startMs = Date.parse(parsed.data.starts_at)
  const endMs = parsed.data.ends_at ? Date.parse(parsed.data.ends_at) : startMs + bs.duration_minutes * 60 * 1000
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return NextResponse.json({ error: 'invalid_times' }, { status: 422 })
  }

  const { data, error } = await admin
    .from('line_messaging_booking_slots')
    .insert({
      booking_service_id: bookingServiceId,
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
      capacity: parsed.data.capacity ?? bs.capacity_per_slot,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'duplicate_slot' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data })
}
