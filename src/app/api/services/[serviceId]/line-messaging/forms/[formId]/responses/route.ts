import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; formId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId, formId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))

  const admin = createSupabaseAdminClient()
  const { data: form } = await admin
    .from('line_messaging_forms')
    .select('id')
    .eq('id', formId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!form) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data, error } = await admin
    .from('line_messaging_form_responses')
    .select('id, contact_id, line_user_id, answers, attribution, submitted_at')
    .eq('form_id', formId)
    .order('submitted_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}
