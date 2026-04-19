import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; definitionId: string }> }

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  match_trigger_type: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, definitionId } = await params
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
  if (parsed.data.match_trigger_type !== undefined) {
    patch.match_trigger_type = parsed.data.match_trigger_type.trim()
  }
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_conversion_definitions')
    .update(patch)
    .eq('id', definitionId)
    .eq('service_id', serviceId)
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, definitionId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: deleted, error } = await admin
    .from('line_messaging_conversion_definitions')
    .delete()
    .eq('id', definitionId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
