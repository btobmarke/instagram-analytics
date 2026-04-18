import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; scenarioId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, scenarioId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: scenario, error: sErr } = await admin
    .from('line_messaging_scenarios')
    .select('*')
    .eq('id', scenarioId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!scenario) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: steps, error: stErr } = await admin
    .from('line_messaging_scenario_steps')
    .select('id, step_order, delay_before_seconds, message_text, created_at, updated_at')
    .eq('scenario_id', scenarioId)
    .order('step_order', { ascending: true })

  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 })
  return NextResponse.json({ success: true, data: { ...scenario, steps: steps ?? [] } })
}

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, scenarioId } = await params
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
  if (parsed.data.description !== undefined) patch.description = parsed.data.description
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_scenarios')
    .update(patch)
    .eq('id', scenarioId)
    .eq('service_id', serviceId)
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, scenarioId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: deleted, error } = await admin
    .from('line_messaging_scenarios')
    .delete()
    .eq('id', scenarioId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
