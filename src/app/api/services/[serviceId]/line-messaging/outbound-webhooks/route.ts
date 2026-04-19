import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { encrypt } from '@/lib/utils/crypto'

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
    .from('line_messaging_outbound_webhooks')
    .select('id, name, target_url, enabled, event_prefixes, created_at, updated_at')
    .eq('service_id', serviceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  name: z.string().min(1).max(200),
  target_url: z.string().url(),
  shared_secret: z.string().min(8).max(500).optional(),
  enabled: z.boolean().optional().default(true),
  event_prefixes: z.array(z.string()).optional().default([]),
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
    .from('line_messaging_outbound_webhooks')
    .insert({
      service_id: serviceId,
      name: parsed.data.name.trim(),
      target_url: parsed.data.target_url,
      secret_enc: parsed.data.shared_secret ? encrypt(parsed.data.shared_secret) : null,
      enabled: parsed.data.enabled,
      event_prefixes: parsed.data.event_prefixes ?? [],
    })
    .select('id, name, target_url, enabled, event_prefixes, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}
