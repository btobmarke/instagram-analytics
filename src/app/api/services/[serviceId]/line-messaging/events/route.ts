import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

/**
 * GET .../events?limit=50&trigger_type=webhook.message
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))
  const triggerType = req.nextUrl.searchParams.get('trigger_type')?.trim()

  const admin = createSupabaseAdminClient()
  let q = admin
    .from('line_messaging_events')
    .select('id, contact_id, line_user_id, trigger_type, payload, occurred_at, created_at')
    .eq('service_id', serviceId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (triggerType) {
    q = q.eq('trigger_type', triggerType)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}
