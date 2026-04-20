import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { MaActionsSchema } from '@/lib/line/ma-action-types'

type Params = { params: Promise<{ serviceId: string; formId: string }> }

const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, formId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: form, error: fErr } = await admin
    .from('line_messaging_forms')
    .select('*')
    .eq('id', formId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })
  if (!form) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: questions, error: qErr } = await admin
    .from('line_messaging_form_questions')
    .select('id, question_order, label, question_type, required, options')
    .eq('form_id', formId)
    .order('question_order', { ascending: true })

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })
  return NextResponse.json({ success: true, data: { ...form, questions: questions ?? [] } })
}

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  slug: SlugSchema.optional(),
  enabled: z.boolean().optional(),
  post_submit_actions: z.unknown().optional(),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, formId } = await params
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
  if (parsed.data.title !== undefined) patch.title = parsed.data.title.trim()
  if (parsed.data.description !== undefined) patch.description = parsed.data.description
  if (parsed.data.slug !== undefined) patch.slug = parsed.data.slug
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled
  if (parsed.data.post_submit_actions !== undefined) {
    const ap = MaActionsSchema.safeParse(parsed.data.post_submit_actions)
    if (!ap.success) {
      return NextResponse.json(
        { error: 'invalid_post_submit_actions', details: ap.error.flatten() },
        { status: 422 },
      )
    }
    patch.post_submit_actions = ap.data
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_forms')
    .update(patch)
    .eq('id', formId)
    .eq('service_id', serviceId)
    .select('*')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'duplicate_slug' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, formId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: deleted, error } = await admin
    .from('line_messaging_forms')
    .delete()
    .eq('id', formId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
