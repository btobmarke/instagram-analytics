import type { SupabaseClient } from '@supabase/supabase-js'
import { parseMaActions } from '@/lib/line/ma-action-types'
import { executeMaActions } from '@/lib/line/execute-ma-actions'

export async function runFormPostSubmitActions(
  admin: SupabaseClient,
  serviceId: string,
  contactId: string | null,
  actionsJson: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actions = parseMaActions(actionsJson)
  if (actions.length === 0) return { ok: true }
  if (!contactId) return { ok: false, error: 'contact_required_for_actions' }

  return executeMaActions(admin, serviceId, contactId, actions)
}
