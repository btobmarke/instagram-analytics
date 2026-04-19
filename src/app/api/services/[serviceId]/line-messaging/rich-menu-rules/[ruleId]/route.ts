import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; ruleId: string }> }

const PatchSchema = z.object({
  priority: z.number().int().min(0).max(1_000_000).optional(),
  rich_menu_id: z.string().uuid().optional(),
  segment_id: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
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

  const admin = createSupabaseAdminClient()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority
  if (parsed.data.rich_menu_id !== undefined) {
    const { data: menu } = await admin
      .from('line_messaging_rich_menus')
      .select('id')
      .eq('id', parsed.data.rich_menu_id)
      .eq('service_id', serviceId)
      .maybeSingle()
    if (!menu) return NextResponse.json({ error: 'rich_menu_not_found' }, { status: 404 })
    patch.rich_menu_id = parsed.data.rich_menu_id
  }
  if (parsed.data.segment_id !== undefined) {
    if (parsed.data.segment_id) {
      const { data: seg } = await admin
        .from('line_messaging_segments')
        .select('id')
        .eq('id', parsed.data.segment_id)
        .eq('service_id', serviceId)
        .maybeSingle()
      if (!seg) return NextResponse.json({ error: 'segment_not_found' }, { status: 404 })
    }
    patch.segment_id = parsed.data.segment_id
  }
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled

  const { data, error } = await admin
    .from('line_messaging_rich_menu_rules')
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
    .from('line_messaging_rich_menu_rules')
    .delete()
    .eq('id', ruleId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
