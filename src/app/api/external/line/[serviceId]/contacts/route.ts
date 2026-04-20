import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateExternalApiKey, requireScope } from '@/lib/line/external-api-auth'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const admin = createSupabaseAdminClient()

  const auth = await validateExternalApiKey(admin, serviceId, req.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!requireScope(auth.scopes, 'contacts:read')) {
    return NextResponse.json({ error: 'insufficient_scope' }, { status: 403 })
  }

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))
  const cursor = req.nextUrl.searchParams.get('cursor')?.trim() || null

  let q = admin
    .from('line_messaging_contacts')
    .select(
      'id, line_user_id, display_name, is_followed, lead_status, first_seen_at, last_interaction_at',
    )
    .eq('service_id', serviceId)
    .order('line_user_id')
    .limit(limit + 1)

  if (cursor) q = q.gt('line_user_id', cursor)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const list = data ?? []
  const hasMore = list.length > limit
  const page = hasMore ? list.slice(0, limit) : list
  const next = hasMore ? page[page.length - 1]?.line_user_id ?? null : null

  return NextResponse.json({ success: true, data: page, next_cursor: next })
}
