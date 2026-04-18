import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ serviceId: string; templateId: string }> }

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

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  body_text: z.string().min(1).max(5000).optional(),
})

/**
 * PATCH /api/services/[serviceId]/line-messaging/templates/[templateId]
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, templateId } = await params
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
  if (parsed.data.body_text !== undefined) patch.body_text = parsed.data.body_text

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_templates')
    .update(patch)
    .eq('id', templateId)
    .eq('service_id', serviceId)
    .select('id, name, body_text, created_at, updated_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

/**
 * DELETE /api/services/[serviceId]/line-messaging/templates/[templateId]
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, templateId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: deleted, error } = await admin
    .from('line_messaging_templates')
    .delete()
    .eq('id', templateId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) {
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'in_use', message: 'このテンプレートを参照している配信ジョブがあるため削除できません' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
