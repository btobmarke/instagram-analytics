import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; reminderId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { serviceId, reminderId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('line_messaging_reminders')
    .select('id, status')
    .eq('id', reminderId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (row.status !== 'scheduled') {
    return NextResponse.json({ error: 'cannot_cancel', status: row.status }, { status: 409 })
  }

  const { error } = await admin
    .from('line_messaging_reminders')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', reminderId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
