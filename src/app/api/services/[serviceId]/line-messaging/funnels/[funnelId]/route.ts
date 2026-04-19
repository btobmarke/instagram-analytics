import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; funnelId: string }> }

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  steps: z.array(z.string().min(1)).min(1).optional(),
  max_step_gap_hours: z.number().int().min(1).max(8760).optional(),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, funnelId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim()
  if (parsed.data.steps !== undefined) {
    patch.steps = parsed.data.steps.map((s) => s.trim()).filter(Boolean)
  }
  if (parsed.data.max_step_gap_hours !== undefined) {
    patch.max_step_gap_hours = parsed.data.max_step_gap_hours
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_funnels')
    .update(patch)
    .eq('id', funnelId)
    .eq('service_id', serviceId)
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, funnelId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: deleted, error } = await admin
    .from('line_messaging_funnels')
    .delete()
    .eq('id', funnelId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
