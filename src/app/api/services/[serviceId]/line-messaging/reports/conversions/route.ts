import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { buildConversionReport } from '@/lib/line/conversion-report'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const from = req.nextUrl.searchParams.get('from')?.trim()
  const to = req.nextUrl.searchParams.get('to')?.trim()
  if (!from || !to) {
    return NextResponse.json({ error: 'from and to (ISO8601) are required' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await buildConversionReport(admin, serviceId, { from, to })
  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ success: true, data })
}
