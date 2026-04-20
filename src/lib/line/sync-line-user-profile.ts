import type { SupabaseClient } from '@supabase/supabase-js'

import { lineBotGetProfile } from '@/lib/line/line-bot-api'

/**
 * LINE Get profile を呼び、line_messaging_contacts の表示系カラムを更新する。
 * line_user_id は既存行と一致している前提（改ざん防止は API 層で contact を検証すること）。
 */
export async function syncLineUserProfileToContact(
  admin: SupabaseClient,
  serviceId: string,
  contactId: string,
  lineUserId: string,
  channelAccessToken: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const pr = await lineBotGetProfile(channelAccessToken, lineUserId)
  if (!pr.ok) {
    return { ok: false, error: pr.message, status: pr.status }
  }
  const { profile } = pr
  const now = new Date().toISOString()
  const { error } = await admin
    .from('line_messaging_contacts')
    .update({
      display_name: profile.displayName || null,
      picture_url: profile.pictureUrl ?? null,
      line_status_message: profile.statusMessage ?? null,
      line_language: profile.language ?? null,
      profile_fetched_at: now,
      updated_at: now,
    })
    .eq('id', contactId)
    .eq('service_id', serviceId)
    .eq('line_user_id', lineUserId.trim())

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
