import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

/**
 * GET /api/services/[serviceId]/line-messaging/contacts
 * Query: tag_id, limit (default 50, max 200), cursor (line_user_id の次ページキー)
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const tagId = req.nextUrl.searchParams.get('tag_id')
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))
  const cursor = req.nextUrl.searchParams.get('cursor')?.trim() || null

  const admin = createSupabaseAdminClient()

  if (tagId) {
    const { data: tag, error: tErr } = await admin
      .from('line_messaging_tags')
      .select('id')
      .eq('id', tagId)
      .eq('service_id', serviceId)
      .maybeSingle()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!tag) return NextResponse.json({ error: 'tag_not_found' }, { status: 404 })

    let linkQ = admin
      .from('line_messaging_contact_tags')
      .select('contact_id')
      .eq('tag_id', tagId)
      .order('contact_id')
      .limit(limit + 1)

    if (cursor) {
      linkQ = linkQ.gt('contact_id', cursor)
    }

    const { data: linkRows, error: lErr } = await linkQ
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })

    const links = linkRows ?? []
    const hasMoreLinks = links.length > limit
    const pageLinks = hasMoreLinks ? links.slice(0, limit) : links
    const contactIds = pageLinks.map((r) => r.contact_id)
    const nextTagCursor = hasMoreLinks ? links[limit]?.contact_id ?? null : null

    if (contactIds.length === 0) {
      return NextResponse.json({ success: true, data: [], next_cursor: null })
    }

    const { data: rows, error: cErr } = await admin
      .from('line_messaging_contacts')
      .select(
        'id, line_user_id, display_name, picture_url, is_followed, lead_status, ops_memo, assignee_app_user_id, first_seen_at, last_interaction_at',
      )
      .eq('service_id', serviceId)
      .in('id', contactIds)

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
    const order = new Map(contactIds.map((id, i) => [id, i]))
    const page = (rows ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    return NextResponse.json({ success: true, data: page, next_cursor: nextTagCursor })
  }

  let q = admin
    .from('line_messaging_contacts')
    .select(
      'id, line_user_id, display_name, picture_url, is_followed, lead_status, ops_memo, assignee_app_user_id, first_seen_at, last_interaction_at',
    )
    .eq('service_id', serviceId)
    .order('line_user_id')
    .limit(limit + 1)

  if (cursor) {
    q = q.gt('line_user_id', cursor)
  }

  const { data: rows, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const list = rows ?? []
  const hasMore = list.length > limit
  const page = hasMore ? list.slice(0, limit) : list
  const next = hasMore ? page[page.length - 1]?.line_user_id ?? null : null
  return NextResponse.json({ success: true, data: page, next_cursor: next })
}
