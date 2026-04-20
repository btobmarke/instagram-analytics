import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { createLineBroadcastJob } from '@/lib/line/create-broadcast-job'

type Params = { params: Promise<{ serviceId: string }> }

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
      'id, template_id, name, snapshot_body_text, recipient_source, segment_id, scheduled_at, status, last_error, started_at, completed_at, created_at, updated_at',
    )
    .eq('service_id', serviceId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostBodySchema = z
  .object({
    template_id: z.string().uuid(),
    name: z.string().max(200).optional(),
    recipient_source: z.enum(['all_followed', 'explicit', 'segment']),
    explicit_line_user_ids: z.array(z.string()).optional(),
    segment_id: z.string().uuid().optional(),
    /** ISO 8601（例: 2026-04-18T12:00:00.000Z） */
    scheduled_at: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.recipient_source === 'explicit' && !val.explicit_line_user_ids?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'explicit_line_user_ids required',
        path: ['explicit_line_user_ids'],
      })
    }
    if (val.recipient_source === 'segment' && !val.segment_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'segment_id required',
        path: ['segment_id'],
      })
    }
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
  const result = await createLineBroadcastJob(admin, serviceId, {
    template_id: parsed.data.template_id,
    name: parsed.data.name,
    recipient_source: parsed.data.recipient_source,
    explicit_line_user_ids: parsed.data.explicit_line_user_ids,
    segment_id: parsed.data.segment_id ?? null,
    scheduled_at: parsed.data.scheduled_at,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    )
  }

  return NextResponse.json({ success: true, data: result.data })
}
