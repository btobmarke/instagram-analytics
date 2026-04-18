import type { SupabaseClient } from '@supabase/supabase-js'
import { lineMessagingReply } from '@/lib/line/messaging-api'
import { logMessagingEvent } from '@/lib/line/log-messaging-event'
import { parseMaActions } from '@/lib/line/ma-action-types'
import { executeMaActions } from '@/lib/line/execute-ma-actions'
import { keywordMatchesRule } from '@/lib/line/match-keyword-rule'

export type WebhookEventForMa = {
  type: string
  timestamp?: number
  source?: { type?: string; userId?: string }
  replyToken?: string
  message?: { type?: string; id?: string; text?: string }
}

async function loadContactId(
  admin: SupabaseClient,
  serviceId: string,
  lineUserId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('line_messaging_contacts')
    .select('id')
    .eq('service_id', serviceId)
    .eq('line_user_id', lineUserId)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Webhook 1 イベント分の MA（ログ・ルール・返信・アクション）
 */
export async function processMaForWebhookEvent(
  admin: SupabaseClient,
  serviceId: string,
  lineUserId: string,
  contactId: string | null,
  ev: WebhookEventForMa,
  channelAccessToken: string | null,
): Promise<void> {
  const occurredAt = ev.timestamp
    ? new Date(ev.timestamp).toISOString()
    : new Date().toISOString()

  const cid =
    contactId ??
    (await loadContactId(admin, serviceId, lineUserId))

  const basePayload = {
    webhook_type: ev.type,
    message: ev.message ?? null,
  }

  if (ev.type === 'follow') {
    await logMessagingEvent(admin, {
      service_id: serviceId,
      contact_id: cid,
      line_user_id: lineUserId,
      trigger_type: 'webhook.follow',
      payload: basePayload,
      occurred_at: occurredAt,
    })

    const { data: rules } = await admin
      .from('line_messaging_ma_rules')
      .select('*')
      .eq('service_id', serviceId)
      .eq('enabled', true)
      .eq('rule_kind', 'follow')
      .order('priority', { ascending: true })

    let replyOnce: string | null = null
    for (const rule of rules ?? []) {
      if (!cid) break
      const actions = parseMaActions(rule.actions)
      const ex = await executeMaActions(admin, serviceId, cid, actions)
      if (!ex.ok) {
        await logMessagingEvent(admin, {
          service_id: serviceId,
          contact_id: cid,
          line_user_id: lineUserId,
          trigger_type: 'ma.action_error',
          payload: { rule_id: rule.id, error: ex.error },
          occurred_at: new Date().toISOString(),
        })
      }
      if (replyOnce === null && rule.reply_text && String(rule.reply_text).trim()) {
        replyOnce = String(rule.reply_text).trim()
      }
    }
    if (replyOnce && ev.replyToken && channelAccessToken) {
      const r = await lineMessagingReply(channelAccessToken, ev.replyToken, [{ type: 'text', text: replyOnce }])
      if (!r.ok) {
        await logMessagingEvent(admin, {
          service_id: serviceId,
          contact_id: cid,
          line_user_id: lineUserId,
          trigger_type: 'ma.reply_error',
          payload: { message: r.message, status: r.status },
          occurred_at: new Date().toISOString(),
        })
      }
    }
    return
  }

  if (ev.type === 'unfollow') {
    await logMessagingEvent(admin, {
      service_id: serviceId,
      contact_id: cid,
      line_user_id: lineUserId,
      trigger_type: 'webhook.unfollow',
      payload: basePayload,
      occurred_at: occurredAt,
    })

    const { data: rules } = await admin
      .from('line_messaging_ma_rules')
      .select('*')
      .eq('service_id', serviceId)
      .eq('enabled', true)
      .eq('rule_kind', 'unfollow')
      .order('priority', { ascending: true })

    for (const rule of rules ?? []) {
      if (!cid) break
      const actions = parseMaActions(rule.actions)
      await executeMaActions(admin, serviceId, cid, actions)
    }
    return
  }

  if (ev.type === 'message' && ev.message?.type === 'text' && ev.message.text !== undefined) {
    const text = ev.message.text
    await logMessagingEvent(admin, {
      service_id: serviceId,
      contact_id: cid,
      line_user_id: lineUserId,
      trigger_type: 'webhook.message',
      payload: { ...basePayload, text },
      occurred_at: occurredAt,
    })

    if (!cid) return

    const { data: rules } = await admin
      .from('line_messaging_ma_rules')
      .select('*')
      .eq('service_id', serviceId)
      .eq('enabled', true)
      .eq('rule_kind', 'keyword')
      .order('priority', { ascending: true })

    for (const rule of rules ?? []) {
      if (!rule.match_type || !rule.pattern) continue
      if (rule.match_type !== 'exact' && rule.match_type !== 'contains') continue
      if (!keywordMatchesRule(text, rule.match_type, rule.pattern)) continue

      const actions = parseMaActions(rule.actions)
      const ex = await executeMaActions(admin, serviceId, cid, actions)
      if (!ex.ok) {
        await logMessagingEvent(admin, {
          service_id: serviceId,
          contact_id: cid,
          line_user_id: lineUserId,
          trigger_type: 'ma.action_error',
          payload: { rule_id: rule.id, error: ex.error },
          occurred_at: new Date().toISOString(),
        })
      }

      if (rule.reply_text && ev.replyToken && channelAccessToken) {
        const r = await lineMessagingReply(channelAccessToken, ev.replyToken, [
          { type: 'text', text: rule.reply_text },
        ])
        if (!r.ok) {
          await logMessagingEvent(admin, {
            service_id: serviceId,
            contact_id: cid,
            line_user_id: lineUserId,
            trigger_type: 'ma.reply_error',
            payload: { rule_id: rule.id, message: r.message, status: r.status },
            occurred_at: new Date().toISOString(),
          })
        }
      }
      break
    }
  }
}
