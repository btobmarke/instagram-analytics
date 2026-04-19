import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

/**
 * GET .../analytics/link-clicks?short_link_id=&from=&to=&limit=
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const shortLinkId = req.nextUrl.searchParams.get('short_link_id')?.trim()
  const from = req.nextUrl.searchParams.get('from')?.trim()
  const to = req.nextUrl.searchParams.get('to')?.trim()
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100))

  if (!shortLinkId || !from || !to) {
    return NextResponse.json(
      { error: 'short_link_id, from, to are required (ISO8601)' },
      { status: 400 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_link_clicks')
    .select('id, short_link_id, contact_id, line_user_id, utm, occurred_at')
    .eq('service_id', serviceId)
    .eq('short_link_id', shortLinkId)
    .gte('occurred_at', from)
    .lte('occurred_at', to)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}
