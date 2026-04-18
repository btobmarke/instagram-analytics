import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ serviceId: string }> }

async function assertLineService(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const { data: service, error } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()
  if (error || !service) return { ok: false, status: 404, body: { error: 'not_found' } }
  if (service.service_type !== 'line') {
    return { ok: false, status: 400, body: { error: 'not_a_line_service' } }
  }
  return { ok: true }
}

/**
 * GET /api/services/[serviceId]/line-messaging/templates
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_templates')
    .select('id, name, body_text, created_at, updated_at')
    .eq('service_id', serviceId)
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostBodySchema = z.object({
  name: z.string().min(1).max(200),
  body_text: z.string().min(1).max(5000),
})

/**
 * POST /api/services/[serviceId]/line-messaging/templates
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PostBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_templates')
    .insert({
      service_id: serviceId,
      name: parsed.data.name.trim(),
      body_text: parsed.data.body_text,
    })
    .select('id, name, body_text, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}
