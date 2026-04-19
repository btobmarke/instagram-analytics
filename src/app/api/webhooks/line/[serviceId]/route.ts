import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/utils/crypto'
import { verifyLineWebhookSignature } from '@/lib/line/verify-webhook-signature'
import { upsertLineMessagingContact } from '@/lib/line/upsert-messaging-contact'
import { processMaForWebhookEvent } from '@/lib/line/process-ma-webhook'

type Params = { params: Promise<{ serviceId: string }> }

type LineWebhookBody = {
  destination?: string
  events?: LineWebhookEvent[]
}

type LineWebhookEvent = {
  type: string
  mode?: string
  timestamp?: number
  source?: { type?: string; userId?: string }
  replyToken?: string
  deliveryContext?: { isRedelivery?: boolean }
  message?: { type?: string; id?: string; text?: string }
  postback?: { data?: string }
}

function bodyDedupeKey(rawBody: string): string {
  const h = createHash('sha256').update(rawBody, 'utf8').digest('hex')
  return `body:${h}`
}

function eventDedupeKeys(rawBody: string, events: LineWebhookEvent[] | undefined): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  if (events?.length) {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i] as LineWebhookEvent & { webhookEventId?: string }
      const id = ev.webhookEventId
      const k = id ? `evt:${id}` : `bodyidx:${createHash('sha256').update(rawBody + `\n${i}`).digest('hex')}`
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  if (keys.length === 0) keys.push(bodyDedupeKey(rawBody))
  return keys
}

/**
 * POST /api/webhooks/line/[serviceId]
 * LINE Messaging API Webhook（署名検証・冪等・contacts UPSERT）
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const rawBody = await request.text()
  const signature = request.headers.get('x-line-signature')

  const admin = createSupabaseAdminClient()

  const { data: service, error: svcErr } = await admin
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()

  if (svcErr || !service) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (service.service_type !== 'line') {
    return NextResponse.json({ error: 'not_a_line_service' }, { status: 404 })
  }

  const { data: credRow, error: credErr } = await admin
    .from('line_messaging_service_credentials')
    .select('channel_secret_enc, channel_access_token_enc')
    .eq('service_id', serviceId)
    .maybeSingle()

  if (credErr || !credRow?.channel_secret_enc) {
    return NextResponse.json({ error: 'messaging_not_configured' }, { status: 503 })
  }

  let channelSecret: string
  let channelAccessToken: string | null = null
  try {
    channelSecret = decrypt(credRow.channel_secret_enc)
    if (credRow.channel_access_token_enc) {
      channelAccessToken = decrypt(credRow.channel_access_token_enc)
    }
  } catch {
    return NextResponse.json({ error: 'credential_error' }, { status: 500 })
  }

  if (!verifyLineWebhookSignature(channelSecret, rawBody, signature)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let parsed: LineWebhookBody
  try {
    parsed = JSON.parse(rawBody) as LineWebhookBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const events = parsed.events ?? []
  const dedupeKeys = eventDedupeKeys(rawBody, events)

  for (const key of dedupeKeys) {
    const { data: claimed, error: claimErr } = await admin.rpc('line_messaging_claim_webhook_event', {
      p_service_id: serviceId,
      p_dedupe_key: key,
    })
    if (claimErr) {
      return NextResponse.json({ error: 'dedupe_failed' }, { status: 500 })
    }
    if (claimed === false) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
  }

  const observedAt = new Date().toISOString()

  for (const ev of events) {
    const userId = ev.source?.type === 'user' ? ev.source.userId : undefined
    if (!userId) continue

    let contactId: string | null = null

    if (ev.type === 'follow') {
      const r = await upsertLineMessagingContact(admin, serviceId, userId, {
        observedAt,
        isFollowed: true,
      })
      if ('error' in r) {
        console.error('[line webhook] upsert follow', serviceId, r.error)
      } else {
        contactId = r.id
      }
    } else if (ev.type === 'unfollow') {
      const r = await upsertLineMessagingContact(admin, serviceId, userId, {
        observedAt,
        isFollowed: false,
      })
      if ('error' in r) {
        console.error('[line webhook] upsert unfollow', serviceId, r.error)
      } else {
        contactId = r.id
      }
    } else if (ev.type === 'message') {
      const r = await upsertLineMessagingContact(admin, serviceId, userId, {
        observedAt,
        isFollowed: true,
      })
      if ('error' in r) {
        console.error('[line webhook] upsert message', serviceId, r.error)
      } else {
        contactId = r.id
      }
    } else if (ev.type === 'postback') {
      const r = await upsertLineMessagingContact(admin, serviceId, userId, {
        observedAt,
        isFollowed: true,
      })
      if ('error' in r) {
        console.error('[line webhook] upsert postback', serviceId, r.error)
      } else {
        contactId = r.id
      }
    }

    await processMaForWebhookEvent(admin, serviceId, userId, contactId, ev, channelAccessToken)
  }

  return NextResponse.json({ ok: true })
}
