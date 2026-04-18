import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; contactId: string }> }

const PutSchema = z.object({
  tag_ids: z.array(z.string().uuid()),
})

/**
 * PUT /api/services/[serviceId]/line-messaging/contacts/[contactId]/tags
 * タグを全置換（tag_ids で指定したタグのみ付与）
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

  const uniqueTagIds = [...new Set(parsed.data.tag_ids)]
  if (uniqueTagIds.length) {
    const { data: tags, error: tErr } = await admin
      .from('line_messaging_tags')
      .select('id')
      .eq('service_id', serviceId)
      .in('id', uniqueTagIds)

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if ((tags ?? []).length !== uniqueTagIds.length) {
      return NextResponse.json({ error: 'invalid_tag_id' }, { status: 400 })
    }
  }

  const { error: delErr } = await admin.from('line_messaging_contact_tags').delete().eq('contact_id', contactId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (uniqueTagIds.length) {
    const rows = uniqueTagIds.map((tag_id) => ({ contact_id: contactId, tag_id }))
    const { error: insErr } = await admin.from('line_messaging_contact_tags').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
