import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { decrypt } from '@/lib/utils/crypto'
import { lineMessagingPush } from '@/lib/line/messaging-api'

type Params = { params: Promise<{ serviceId: string; templateId: string }> }

const BodySchema = z.object({
  to: z.string().min(1).max(128),
})

/**
 * POST — 保存済み template_json を 1 ユーザーへ push（プレビュー用）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId, templateId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: tpl, error: tErr } = await admin
    .from('line_messaging_flex_templates')
    .select('template_kind, template_json')
    .eq('id', templateId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (tErr || !tpl) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: cred } = await admin
    .from('line_messaging_service_credentials')
    .select('channel_access_token_enc')
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!cred?.channel_access_token_enc) {
    return NextResponse.json({ error: 'messaging_not_configured' }, { status: 400 })
  }

  let token: string
  try {
    token = decrypt(cred.channel_access_token_enc)
  } catch {
    return NextResponse.json({ error: 'credential_error' }, { status: 500 })
  }

  const raw = tpl.template_json as unknown
  let message: Record<string, unknown>

  if (tpl.template_kind === 'carousel') {
    const bubbles = Array.isArray(raw)
      ? raw
      : raw &&
          typeof raw === 'object' &&
          'contents' in raw &&
          Array.isArray((raw as { contents: unknown }).contents)
        ? (raw as { contents: unknown[] }).contents
        : null
    if (!bubbles?.length) {
      return NextResponse.json(
        { error: 'invalid_carousel_json', hint: 'template_json はバブル配列、または { contents: [バブル...] }' },
        { status: 422 },
      )
    }
    const alt =
      raw && typeof raw === 'object' && 'altText' in raw && typeof (raw as { altText?: string }).altText === 'string'
        ? (raw as { altText: string }).altText
        : 'Carousel'
    message = {
      type: 'flex',
      altText: alt,
      contents: { type: 'carousel', contents: bubbles },
    }
  } else {
    const j = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    let bubble: unknown = j
    let altText = 'Flex message'
    if (j.contents && typeof j.contents === 'object') {
      bubble = j.contents
      if (typeof j.altText === 'string') altText = j.altText
    } else if (typeof j.altText === 'string') {
      altText = j.altText
    }
    message = { type: 'flex', altText, contents: bubble }
  }

  const result = await lineMessagingPush(token, parsed.data.to.trim(), [message])
  if (!result.ok) {
    return NextResponse.json(
      { error: 'line_api_error', message: result.message, status: result.status },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true, request_id: result.requestId })
}
