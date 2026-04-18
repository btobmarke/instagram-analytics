import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Webhook / Messaging API から得た userId を line_messaging_contacts に UPSERT。
 * 同一 (service_id, line_user_id) は last_interaction_at を更新し、初回のみ first_seen_at を保持。
 */
export async function upsertLineMessagingContact(
  supabase: SupabaseClient,
  serviceId: string,
  lineUserId: string,
  opts?: {
    displayName?: string | null
    pictureUrl?: string | null
    observedAt?: string
  },
): Promise<{ id: string } | { error: string }> {
  const now = opts?.observedAt ?? new Date().toISOString()
  const trimmed = lineUserId.trim()
  if (!trimmed) {
    return { error: 'lineUserId is empty' }
  }

  const { data: existing, error: selErr } = await supabase
    .from('line_messaging_contacts')
    .select('id, first_seen_at')
    .eq('service_id', serviceId)
    .eq('line_user_id', trimmed)
    .maybeSingle()

  if (selErr) {
    return { error: selErr.message }
  }

  if (existing) {
    const patch: Record<string, unknown> = {
      last_interaction_at: now,
      updated_at: now,
    }
    if (opts?.displayName !== undefined) patch.display_name = opts.displayName
    if (opts?.pictureUrl !== undefined) patch.picture_url = opts.pictureUrl

    const { data, error } = await supabase
      .from('line_messaging_contacts')
      .update(patch)
      .eq('id', existing.id)
      .select('id')
      .single()
    if (error || !data) {
      return { error: error?.message ?? 'update failed' }
    }
    return { id: data.id }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('line_messaging_contacts')
    .insert({
      service_id: serviceId,
      line_user_id: trimmed,
      display_name: opts?.displayName ?? null,
      picture_url: opts?.pictureUrl ?? null,
      first_seen_at: now,
      last_interaction_at: now,
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    return { error: insErr?.message ?? 'insert failed' }
  }
  return { id: inserted.id }
}
