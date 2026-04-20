import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateExternalApiKey, requireScope } from '@/lib/line/external-api-auth'

type Params = { params: Promise<{ serviceId: string; lineUserId: string }> }

const PutSchema = z.object({
  tag_ids: z.array(z.string().uuid()),
})

export async function PUT(req: NextRequest, { params }: Params) {
  const { serviceId, lineUserId } = await params
  const admin = createSupabaseAdminClient()

  const auth = await validateExternalApiKey(admin, serviceId, req.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!requireScope(auth.scopes, 'tags:write')) {
    return NextResponse.json({ error: 'insufficient_scope' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const uid = decodeURIComponent(lineUserId).trim()
  const { data: contact, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('id')
    .eq('service_id', serviceId)
    .eq('line_user_id', uid)
    .maybeSingle()

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: 'contact_not_found' }, { status: 404 })

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

  const { error: delErr } = await admin.from('line_messaging_contact_tags').delete().eq('contact_id', contact.id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (uniqueTagIds.length) {
    const rows = uniqueTagIds.map((tag_id) => ({ contact_id: contact.id, tag_id }))
    const { error: insErr } = await admin.from('line_messaging_contact_tags').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
