import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ serviceId: string; jobId: string }> }

async function assertLineService(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const { data: service, error } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()
  if (error || !service) return { ok: false, status: 404, body: { error: 'not_found' } }
  if (service.service_type !== 'line') {
    return { ok: false, status: 400, body: { error: 'not_a_line_service' } }
  }
  return { ok: true }
}

/**
 * POST /api/services/[serviceId]/line-messaging/broadcast-jobs/[jobId]/cancel
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { serviceId, jobId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: job } = await admin
    .from('line_messaging_broadcast_jobs')
    .select('id, status')
    .eq('id', jobId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!['scheduled', 'processing'].includes(job.status)) {
    return NextResponse.json({ error: 'cannot_cancel', status: job.status }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('line_messaging_broadcast_jobs')
    .update({
      status: 'cancelled',
      completed_at: now,
      updated_at: now,
    })
    .eq('id', jobId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
