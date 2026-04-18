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
 * GET /api/services/[serviceId]/line-messaging/broadcast-jobs/[jobId]
 * ジョブ詳細・受信者集計・直近の受信者一覧
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId, jobId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: job, error: jobErr } = await admin
    .from('line_messaging_broadcast_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { count: pending } = await admin
    .from('line_messaging_broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('status', 'pending')

  const { count: sent } = await admin
    .from('line_messaging_broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('status', 'sent')

  const { count: failed } = await admin
    .from('line_messaging_broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('status', 'failed')

  const limitParam = req.nextUrl.searchParams.get('recipient_limit')
  const limit = Math.min(500, Math.max(1, Number(limitParam) || 100))

  const { data: recipients, error: recErr } = await admin
    .from('line_messaging_broadcast_recipients')
    .select('id, line_user_id, status, error_message, line_request_id, sent_at, updated_at')
    .eq('job_id', jobId)
    .order('line_user_id')
    .limit(limit)

  if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: {
      job,
      recipient_counts: {
        pending: pending ?? 0,
        sent: sent ?? 0,
        failed: failed ?? 0,
      },
      recipients: recipients ?? [],
    },
  })
}
