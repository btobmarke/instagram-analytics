import type { SupabaseClient } from '@supabase/supabase-js'
import { parseMaActions } from '@/lib/line/ma-action-types'
import { executeMaActions } from '@/lib/line/execute-ma-actions'
import { logMessagingEvent } from '@/lib/line/log-messaging-event'

export async function processPostbackEvent(
  admin: SupabaseClient,
  serviceId: string,
  contactId: string | null,
  lineUserId: string,
  data: string,
): Promise<void> {
  const key = data.trim().slice(0, 300)
  if (!key) return

  await logMessagingEvent(admin, {
    service_id: serviceId,
    contact_id: contactId,
    line_user_id: lineUserId,
    trigger_type: 'webhook.postback',
    payload: { data: key },
  })

  const { data: binding } = await admin
    .from('line_messaging_postback_bindings')
    .select('actions')
    .eq('service_id', serviceId)
    .eq('data_key', key)
    .maybeSingle()

  if (!binding) return

  const actions = parseMaActions(binding.actions)
  if (actions.length === 0 || !contactId) {
    if (actions.length > 0 && !contactId) {
      await logMessagingEvent(admin, {
        service_id: serviceId,
        contact_id: null,
        line_user_id: lineUserId,
        trigger_type: 'ma.postback_action_skipped',
        payload: { reason: 'no_contact', data: key },
      })
    }
    return
  }

  const ex = await executeMaActions(admin, serviceId, contactId, actions)
  if (!ex.ok) {
    await logMessagingEvent(admin, {
      service_id: serviceId,
      contact_id: contactId,
      line_user_id: lineUserId,
      trigger_type: 'ma.action_error',
      payload: { source: 'postback', data: key, error: ex.error },
    })
  }
}
