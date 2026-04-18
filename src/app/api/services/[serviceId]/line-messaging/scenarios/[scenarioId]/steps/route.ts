import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; scenarioId: string }> }

const PutSchema = z.object({
  steps: z
    .array(
      z.object({
        step_order: z.number().int().min(0).max(999),
        delay_before_seconds: z.number().int().min(0).max(86400 * 30).default(0),
        message_text: z.string().min(1).max(5000),
      }),
    )
    .min(1),
})

/**
 * PUT .../scenarios/[scenarioId]/steps — ステップを全置換
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { serviceId, scenarioId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const orders = parsed.data.steps.map((s) => s.step_order)
  if (new Set(orders).size !== orders.length) {
    return NextResponse.json({ error: 'duplicate_step_order' }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data: scenario, error: sErr } = await admin
    .from('line_messaging_scenarios')
    .select('id')
    .eq('id', scenarioId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (sErr || !scenario) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error: delErr } = await admin.from('line_messaging_scenario_steps').delete().eq('scenario_id', scenarioId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  const rows = parsed.data.steps.map((s) => ({
    scenario_id: scenarioId,
    step_order: s.step_order,
    delay_before_seconds: s.delay_before_seconds ?? 0,
    message_text: s.message_text,
  }))

  const { error: insErr } = await admin.from('line_messaging_scenario_steps').insert(rows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  const { data: steps } = await admin
    .from('line_messaging_scenario_steps')
    .select('id, step_order, delay_before_seconds, message_text')
    .eq('scenario_id', scenarioId)
    .order('step_order', { ascending: true })

  return NextResponse.json({ success: true, data: steps ?? [] })
}
