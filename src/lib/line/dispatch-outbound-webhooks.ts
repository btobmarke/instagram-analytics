import { createHmac } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/utils/crypto'

function shouldSend(prefixes: unknown, triggerType: string): boolean {
  if (!Array.isArray(prefixes) || prefixes.length === 0) return true
  return prefixes.some((p) => typeof p === 'string' && triggerType.startsWith(p))
}

/**
 * line_messaging_events 挿入後に、登録済み Outbound Webhook へ POST（I1）
 */
export async function dispatchOutboundWebhooks(
  admin: SupabaseClient,
  row: {
    service_id: string
    contact_id?: string | null
    line_user_id?: string | null
    trigger_type: string
    payload?: Record<string, unknown>
    occurred_at?: string
  },
): Promise<void> {
  const { data: hooks, error } = await admin
    .from('line_messaging_outbound_webhooks')
    .select('id, target_url, secret_enc, event_prefixes')
    .eq('service_id', row.service_id)
    .eq('enabled', true)

  if (error || !hooks?.length) return

  const bodyObj = {
    event: {
      trigger_type: row.trigger_type,
      occurred_at: row.occurred_at ?? new Date().toISOString(),
      service_id: row.service_id,
      contact_id: row.contact_id ?? null,
      line_user_id: row.line_user_id ?? null,
      payload: row.payload ?? {},
    },
  }
  const body = JSON.stringify(bodyObj)

  for (const h of hooks) {
    if (!shouldSend(h.event_prefixes, row.trigger_type)) continue

    let sig: string | undefined
    if (h.secret_enc) {
      try {
        const secret = decrypt(h.secret_enc)
        sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
      } catch {
        continue
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'instagram-analytics-line-webhook/1.0',
    }
    if (sig) headers['X-Line-Ma-Signature'] = sig

    try {
      const res = await fetch(h.target_url, { method: 'POST', headers, body })
      if (!res.ok) {
        console.warn('[outbound-webhook]', h.id, res.status, await res.text().catch(() => ''))
      }
    } catch (e) {
      console.warn('[outbound-webhook]', h.id, e)
    }
  }
}
