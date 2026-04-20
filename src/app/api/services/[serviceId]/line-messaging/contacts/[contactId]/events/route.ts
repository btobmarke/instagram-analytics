import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; contactId: string }> }

/**
 * GET .../contacts/[contactId]/events?limit=50
 * 同一コンタクトの line_messaging_events（新しい順）。contact_id が付いていない古い行は line_user_id で拾う。
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId, contactId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))

  const admin = createSupabaseAdminClient()
  const { data: contact, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('id, line_user_id')
    .eq('id', contactId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const lineUserId = contact.line_user_id as string

  const { data: byContact, error: e1 } = await admin
    .from('line_messaging_events')
    .select('id, trigger_type, payload, occurred_at, created_at, contact_id, line_user_id')
    .eq('service_id', serviceId)
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  const { data: byUserOnly, error: e2 } = await admin
    .from('line_messaging_events')
    .select('id, trigger_type, payload, occurred_at, created_at, contact_id, line_user_id')
    .eq('service_id', serviceId)
    .eq('line_user_id', lineUserId)
    .is('contact_id', null)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  type Row = {
    id: string
    trigger_type: string
    payload: unknown
    occurred_at: string
    created_at: string
    contact_id: string | null
    line_user_id: string | null
  }
  const map = new Map<string, Row>()
  for (const row of [...(byContact ?? []), ...(byUserOnly ?? [])] as Row[]) {
    if (row?.id) map.set(row.id, row)
  }
  const merged = [...map.values()].sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  )
  const page = merged.slice(0, limit)

  return NextResponse.json({ success: true, data: page })
}
