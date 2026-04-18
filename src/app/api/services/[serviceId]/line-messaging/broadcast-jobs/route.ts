import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizeExplicitUserIds, seedBroadcastRecipients } from '@/lib/line/process-broadcast-job-chunk'

type Params = { params: Promise<{ serviceId: string }> }

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
 * GET /api/services/[serviceId]/line-messaging/broadcast-jobs
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_broadcast_jobs')
    .select(
      'id, template_id, name, snapshot_body_text, recipient_source, scheduled_at, status, last_error, started_at, completed_at, created_at, updated_at',
    )
    .eq('service_id', serviceId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostBodySchema = z.object({
  template_id: z.string().uuid(),
  name: z.string().max(200).optional(),
  recipient_source: z.enum(['all_followed', 'explicit']),
  explicit_line_user_ids: z.array(z.string()).optional(),
  /** ISO 8601（例: 2026-04-18T12:00:00.000Z） */
  scheduled_at: z.string().optional(),
})

/**
 * POST /api/services/[serviceId]/line-messaging/broadcast-jobs
 * 一斉配信ジョブを作成し、受信者行を投入（scheduled_at 以降にバッチが送信）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PostBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: template, error: tplErr } = await admin
    .from('line_messaging_templates')
    .select('id, body_text')
    .eq('id', parsed.data.template_id)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (tplErr || !template) {
    return NextResponse.json({ error: 'template_not_found' }, { status: 404 })
  }

  let scheduledAt = new Date().toISOString()
  if (parsed.data.scheduled_at !== undefined && parsed.data.scheduled_at !== '') {
    const ms = Date.parse(parsed.data.scheduled_at)
    if (Number.isNaN(ms)) {
      return NextResponse.json({ error: 'invalid_scheduled_at' }, { status: 422 })
    }
    scheduledAt = new Date(ms).toISOString()
  }

  let lineUserIds: string[] = []
  if (parsed.data.recipient_source === 'explicit') {
    lineUserIds = normalizeExplicitUserIds(parsed.data.explicit_line_user_ids ?? [])
    if (lineUserIds.length === 0) {
      return NextResponse.json(
        { error: 'explicit_line_user_ids required for explicit source' },
        { status: 400 },
      )
    }
  } else {
    const { data: contacts, error: cErr } = await admin
      .from('line_messaging_contacts')
      .select('line_user_id')
      .eq('service_id', serviceId)
      .eq('is_followed', true)

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
    lineUserIds = (contacts ?? []).map((r) => r.line_user_id).filter(Boolean)
    if (lineUserIds.length === 0) {
      return NextResponse.json({ error: 'no_followed_contacts' }, { status: 400 })
    }
  }

  const { data: job, error: jobErr } = await admin
    .from('line_messaging_broadcast_jobs')
    .insert({
      service_id: serviceId,
      template_id: template.id,
      name: parsed.data.name?.trim() ?? null,
      snapshot_body_text: template.body_text,
      recipient_source: parsed.data.recipient_source,
      explicit_line_user_ids:
        parsed.data.recipient_source === 'explicit'
          ? lineUserIds
          : null,
      scheduled_at: scheduledAt,
      status: 'scheduled',
    })
    .select(
      'id, template_id, name, snapshot_body_text, recipient_source, scheduled_at, status, created_at',
    )
    .single()

  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? 'insert failed' }, { status: 500 })
  }

  const seed = await seedBroadcastRecipients(admin, job.id, lineUserIds)
  if (seed.error) {
    await admin.from('line_messaging_broadcast_jobs').delete().eq('id', job.id)
    return NextResponse.json({ error: seed.error }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: job })
}
