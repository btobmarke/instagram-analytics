import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; contactId: string }> }

const PutSchema = z.object({
  values: z.array(
    z.object({
      definition_id: z.string().uuid(),
      value_text: z.string().max(4000),
    }),
  ),
})

/**
 * PUT /api/services/[serviceId]/line-messaging/contacts/[contactId]/attributes
 * 指定した定義の値のみ upsert（省略した定義は変更しない）
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { serviceId, contactId } = await params
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

  const admin = createSupabaseAdminClient()
  const { data: contact, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('id')
    .eq('id', contactId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  for (const v of parsed.data.values) {
    const { data: def, error: dErr } = await admin
      .from('line_messaging_attribute_definitions')
      .select('id, value_type, select_options')
      .eq('id', v.definition_id)
      .eq('service_id', serviceId)
      .maybeSingle()

    if (dErr || !def) {
      return NextResponse.json({ error: 'unknown_definition', definition_id: v.definition_id }, { status: 400 })
    }

    if (def.value_type === 'select') {
      const opts = (def.select_options as string[] | null) ?? []
      if (!opts.includes(v.value_text)) {
        return NextResponse.json(
          { error: 'invalid_select_value', definition_id: v.definition_id },
          { status: 422 },
        )
      }
    }

    if (def.value_type === 'number' && Number.isNaN(Number(v.value_text.trim()))) {
      return NextResponse.json(
        { error: 'invalid_number_value', definition_id: v.definition_id },
        { status: 422 },
      )
    }
  }

  const now = new Date().toISOString()
  for (const v of parsed.data.values) {
    const { error } = await admin.from('line_messaging_contact_attribute_values').upsert(
      {
        contact_id: contactId,
        definition_id: v.definition_id,
        value_text: v.value_text,
        updated_at: now,
      },
      { onConflict: 'contact_id,definition_id' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
