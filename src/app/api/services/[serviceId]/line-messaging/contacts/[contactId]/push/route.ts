import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { decrypt } from '@/lib/utils/crypto'
import { lineMessagingPush } from '@/lib/line/messaging-api'
import { logMessagingEvent } from '@/lib/line/log-messaging-event'

type Params = { params: Promise<{ serviceId: string; contactId: string }> }

const BodySchema = z.object({
  text: z.string().min(1).max(5000),
})

/**
 * POST .../contacts/[contactId]/push
 * ダッシュボードから当該コンタクトへテキスト Push（LINE Messaging API）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId, contactId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const text = parsed.data.text.trim()
  if (!text) {
    return NextResponse.json({ error: 'validation_error', message: 'text が空です' }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data: cred, error: credErr } = await admin
    .from('line_messaging_service_credentials')
    .select('channel_access_token_enc')
    .eq('service_id', serviceId)
    .maybeSingle()

  if (credErr || !cred?.channel_access_token_enc) {
    return NextResponse.json({ error: 'messaging_not_configured' }, { status: 400 })
  }

  let token: string
  try {
    token = decrypt(cred.channel_access_token_enc)
  } catch {
    return NextResponse.json({ error: 'credential_decrypt_failed' }, { status: 500 })
  }

  const { data: row, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('id, line_user_id')
    .eq('id', contactId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (cErr || !row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const lineUserId = String(row.line_user_id ?? '').trim()
  if (!lineUserId) {
    return NextResponse.json({ error: 'invalid_contact' }, { status: 400 })
  }

  const result = await lineMessagingPush(token, lineUserId, [{ type: 'text', text }])

  if (!result.ok) {
    await logMessagingEvent(admin, {
      service_id: serviceId,
      contact_id: contactId,
      line_user_id: lineUserId,
      trigger_type: 'dashboard.contact_push_error',
      payload: {
        status: result.status,
        message: result.message,
        text_length: text.length,
      },
    })
    return NextResponse.json(
      {
        error: 'line_api_error',
        status: result.status,
        message: result.message,
        request_id: result.requestId,
      },
      { status: 502 },
    )
  }

  const now = new Date().toISOString()
  await admin
    .from('line_messaging_contacts')
    .update({ last_interaction_at: now, updated_at: now })
    .eq('id', contactId)
    .eq('service_id', serviceId)

  await logMessagingEvent(admin, {
    service_id: serviceId,
    contact_id: contactId,
    line_user_id: lineUserId,
    trigger_type: 'dashboard.contact_push',
    payload: {
      text_length: text.length,
      request_id: result.requestId ?? null,
      sent_by_app_user_id: user.id,
    },
  })

  return NextResponse.json({ success: true, request_id: result.requestId })
}
