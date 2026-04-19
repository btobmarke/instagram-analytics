import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateExternalApiKey, requireScope } from '@/lib/line/external-api-auth'
import { createLineBroadcastJob } from '@/lib/line/create-broadcast-job'

type Params = { params: Promise<{ serviceId: string }> }

const BodySchema = z
  .object({
    template_id: z.string().uuid(),
    name: z.string().max(200).optional(),
    recipient_source: z.enum(['all_followed', 'explicit', 'segment']),
    explicit_line_user_ids: z.array(z.string()).optional(),
    segment_id: z.string().uuid().optional(),
    scheduled_at: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.recipient_source === 'explicit' && !val.explicit_line_user_ids?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'explicit_line_user_ids required', path: ['explicit_line_user_ids'] })
    }
    if (val.recipient_source === 'segment' && !val.segment_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'segment_id required', path: ['segment_id'] })
    }
  })

export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const admin = createSupabaseAdminClient()

  const auth = await validateExternalApiKey(admin, serviceId, req.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!requireScope(auth.scopes, 'broadcast:write')) {
    return NextResponse.json({ error: 'insufficient_scope' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const result = await createLineBroadcastJob(admin, serviceId, {
    template_id: parsed.data.template_id,
    name: parsed.data.name,
    recipient_source: parsed.data.recipient_source,
    explicit_line_user_ids: parsed.data.explicit_line_user_ids,
    segment_id: parsed.data.segment_id ?? null,
    scheduled_at: parsed.data.scheduled_at,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  return NextResponse.json({ success: true, data: result.data })
}
