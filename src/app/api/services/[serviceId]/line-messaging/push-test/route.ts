import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/utils/crypto'
import { lineMessagingPush } from '@/lib/line/messaging-api'

type Params = { params: Promise<{ serviceId: string }> }

const BodySchema = z.object({
  to: z.string().min(1, 'to（LINE userId）は必須です'),
  text: z.string().min(1).max(5000).default('テスト配信です'),
})

/**
 * POST /api/services/[serviceId]/line-messaging/push-test
 * 保存済み channel access token でテキスト push（運用確認用）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: service, error: svcErr } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()

  if (svcErr || !service) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (service.service_type !== 'line') {
    return NextResponse.json({ error: 'not_a_line_service' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
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

  const result = await lineMessagingPush(token, parsed.data.to.trim(), [
    { type: 'text', text: parsed.data.text },
  ])

  if (!result.ok) {
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

  return NextResponse.json({ success: true, request_id: result.requestId })
}
