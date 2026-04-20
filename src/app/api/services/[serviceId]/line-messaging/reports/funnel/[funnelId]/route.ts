import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { buildFunnelReport } from '@/lib/line/funnel-report'

type Params = { params: Promise<{ serviceId: string; funnelId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, funnelId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await buildFunnelReport(admin, serviceId, funnelId)
  if (error === 'not_found') return NextResponse.json({ error }, { status: 404 })
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ success: true, data })
}
