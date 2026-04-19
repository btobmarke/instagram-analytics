import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_booking_services')
    .select('*')
    .eq('service_id', serviceId)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  duration_minutes: z.number().int().min(5).max(1440).optional().default(30),
  capacity_per_slot: z.number().int().min(1).max(100).optional().default(1),
  is_active: z.boolean().optional().default(true),
})

export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_booking_services')
    .insert({
      service_id: serviceId,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() ?? null,
      duration_minutes: parsed.data.duration_minutes,
      capacity_per_slot: parsed.data.capacity_per_slot,
      is_active: parsed.data.is_active,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}
