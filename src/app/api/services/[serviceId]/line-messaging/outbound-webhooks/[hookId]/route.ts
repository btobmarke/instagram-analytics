import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { encrypt } from '@/lib/utils/crypto'

type Params = { params: Promise<{ serviceId: string; hookId: string }> }

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  target_url: z.string().url().optional(),
  shared_secret: z.string().min(8).max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  event_prefixes: z.array(z.string()).optional(),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, hookId } = await params
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
  if (parsed.data.target_url !== undefined) patch.target_url = parsed.data.target_url
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled
  if (parsed.data.event_prefixes !== undefined) patch.event_prefixes = parsed.data.event_prefixes
  if (parsed.data.shared_secret !== undefined) {
    patch.secret_enc = parsed.data.shared_secret ? encrypt(parsed.data.shared_secret) : null
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_outbound_webhooks')
    .update(patch)
    .eq('id', hookId)
    .eq('service_id', serviceId)
    .select('id, name, target_url, enabled, event_prefixes, updated_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, hookId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: deleted, error } = await admin
    .from('line_messaging_outbound_webhooks')
    .delete()
    .eq('id', hookId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
