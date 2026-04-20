import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

const CONTACT_SELECT =
  'id, line_user_id, display_name, picture_url, line_status_message, line_language, profile_fetched_at, is_followed, lead_status, ops_memo, assignee_app_user_id, first_seen_at, last_interaction_at'

/** ILIKE 用に % _ \ をエスケープ */
function escapeIlikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * GET /api/services/[serviceId]/line-messaging/contacts
 * Query: tag_id, search（表示名 or line_user_id の部分一致）, limit (default 50, max 200), cursor（line_user_id の次ページキー）
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const tagId = req.nextUrl.searchParams.get('tag_id')?.trim() || null
  const searchRaw = req.nextUrl.searchParams.get('search')?.trim() ?? ''
  const search = searchRaw.slice(0, 200)
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))
  const cursor = req.nextUrl.searchParams.get('cursor')?.trim() || null

  const admin = createSupabaseAdminClient()

  const searchOr =
    search.length > 0
      ? `display_name.ilike.%${escapeIlikePattern(search)}%,line_user_id.ilike.%${escapeIlikePattern(search)}%`
      : null

  if (tagId) {
    const { data: tag, error: tErr } = await admin
      .from('line_messaging_tags')
      .select('id')
      .eq('id', tagId)
      .eq('service_id', serviceId)
      .maybeSingle()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!tag) return NextResponse.json({ error: 'tag_not_found' }, { status: 404 })

    let q = admin
      .from('line_messaging_contacts')
      .select(`${CONTACT_SELECT}, line_messaging_contact_tags!inner(tag_id)`)
      .eq('service_id', serviceId)
      .eq('line_messaging_contact_tags.tag_id', tagId)
      .order('line_user_id', { ascending: true })
      .limit(limit + 1)

    if (searchOr) q = q.or(searchOr)
    if (cursor) q = q.gt('line_user_id', cursor)

    const { data: rows, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const list = rows ?? []
    const hasMore = list.length > limit
    const page = hasMore ? list.slice(0, limit) : list
    const next = hasMore ? page[page.length - 1]?.line_user_id ?? null : null
    const stripped = page.map((row) => {
      const { line_messaging_contact_tags: _t, ...c } = row as Record<string, unknown>
      return c
    })
    return NextResponse.json({ success: true, data: stripped, next_cursor: next })
  }

  let q = admin
    .from('line_messaging_contacts')
    .select(CONTACT_SELECT)
    .eq('service_id', serviceId)
    .order('line_user_id', { ascending: true })
    .limit(limit + 1)

  if (searchOr) q = q.or(searchOr)
  if (cursor) q = q.gt('line_user_id', cursor)

  const { data: rows, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const list = rows ?? []
  const hasMore = list.length > limit
  const page = hasMore ? list.slice(0, limit) : list
  const next = hasMore ? page[page.length - 1]?.line_user_id ?? null : null
  return NextResponse.json({ success: true, data: page, next_cursor: next })
}
