import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; contactId: string }> }

const PatchSchema = z.object({
  lead_status: z.string().max(200).nullable().optional(),
  ops_memo: z.string().max(8000).nullable().optional(),
  assignee_app_user_id: z.string().uuid().nullable().optional(),
})

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, contactId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: contact, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('*')
    .eq('id', contactId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: tagLinks } = await admin
    .from('line_messaging_contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId)

  const tagIds = (tagLinks ?? []).map((r) => r.tag_id)
  const { data: tags } =
    tagIds.length > 0
      ? await admin.from('line_messaging_tags').select('id, name, color').in('id', tagIds)
      : { data: [] as { id: string; name: string; color: string | null }[] }

  const { data: attrVals } = await admin
    .from('line_messaging_contact_attribute_values')
    .select('id, value_text, definition_id')
    .eq('contact_id', contactId)

  const defIds = [...new Set((attrVals ?? []).map((r) => r.definition_id))]
  const { data: defs } =
    defIds.length > 0
      ? await admin
          .from('line_messaging_attribute_definitions')
          .select('id, code, label, value_type, select_options')
          .in('id', defIds)
      : { data: [] as Record<string, unknown>[] }

  const defById = new Map((defs ?? []).map((d) => [d.id, d]))

  return NextResponse.json({
    success: true,
    data: {
      contact,
      tags: tags ?? [],
      attribute_values: (attrVals ?? []).map((row) => ({
        ...row,
        definition: defById.get(row.definition_id) ?? null,
      })),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, contactId } = await params
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
  if (parsed.data.lead_status !== undefined) patch.lead_status = parsed.data.lead_status
  if (parsed.data.ops_memo !== undefined) patch.ops_memo = parsed.data.ops_memo
  if (parsed.data.assignee_app_user_id !== undefined) {
    patch.assignee_app_user_id = parsed.data.assignee_app_user_id
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('service_id', serviceId)
    .select(
      'id, line_user_id, display_name, picture_url, line_status_message, line_language, profile_fetched_at, is_followed, lead_status, ops_memo, assignee_app_user_id, first_seen_at, last_interaction_at',
    )
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}
