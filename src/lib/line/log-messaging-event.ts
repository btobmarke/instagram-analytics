import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchOutboundWebhooks } from '@/lib/line/dispatch-outbound-webhooks'

export async function logMessagingEvent(
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
  const occurredAt = row.occurred_at ?? new Date().toISOString()
  const { error } = await admin.from('line_messaging_events').insert({
    service_id: row.service_id,
    contact_id: row.contact_id ?? null,
    line_user_id: row.line_user_id ?? null,
    trigger_type: row.trigger_type,
    payload: row.payload ?? {},
    occurred_at: occurredAt,
  })
  if (error) {
    console.error('[line_ma] logMessagingEvent', error.message)
    return
  }

  void dispatchOutboundWebhooks(admin, { ...row, occurred_at: occurredAt }).catch(() => {})
}
