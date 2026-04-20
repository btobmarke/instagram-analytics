import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { MaActionsSchema } from '@/lib/line/ma-action-types'

type Params = { params: Promise<{ serviceId: string; ruleId: string }> }

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  match_type: z.enum(['exact', 'contains']).optional(),
  pattern: z.string().min(1).max(500).optional(),
  reply_text: z.string().max(5000).nullable().optional(),
  actions: z.unknown().optional(),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, ruleId } = await params
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

  if (parsed.data.actions !== undefined) {
    const ap = MaActionsSchema.safeParse(parsed.data.actions)
    if (!ap.success) {
      return NextResponse.json(
        { error: 'invalid_actions', details: ap.error.flatten() },
        { status: 422 },
      )
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim()
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority
  if (parsed.data.match_type !== undefined) patch.match_type = parsed.data.match_type
  if (parsed.data.pattern !== undefined) patch.pattern = parsed.data.pattern.trim()
  if (parsed.data.reply_text !== undefined) patch.reply_text = parsed.data.reply_text
  if (parsed.data.actions !== undefined) {
    const ap = MaActionsSchema.parse(parsed.data.actions)
    patch.actions = ap
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_ma_rules')
    .update(patch)
    .eq('id', ruleId)
    .eq('service_id', serviceId)
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, ruleId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: deleted, error } = await admin
    .from('line_messaging_ma_rules')
    .delete()
    .eq('id', ruleId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
