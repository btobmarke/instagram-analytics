import type { SupabaseClient } from '@supabase/supabase-js'
import { SegmentDefinitionSchema } from '@/lib/line/segment-definition'
import { resolveSegmentLineUserIds } from '@/lib/line/evaluate-segment'
import { lineBotLinkRichMenuToUser } from '@/lib/line/line-bot-api'

/**
 * セグメント別ルールに従い、ユーザにリッチメニューをリンクする（F2）
 */
export async function applyRichMenuForContact(
  admin: SupabaseClient,
  serviceId: string,
  lineUserId: string,
  channelAccessToken: string,
): Promise<{ linked?: string; skipped?: boolean; error?: string }> {
  const { data: rules, error } = await admin
    .from('line_messaging_rich_menu_rules')
    .select('id, priority, rich_menu_id, segment_id')
    .eq('service_id', serviceId)
    .eq('enabled', true)
    .order('priority', { ascending: true })

  if (error) return { error: error.message }

  const rows = rules ?? []
  const withSegment = rows.filter((r) => r.segment_id)
  const fallbacks = rows.filter((r) => !r.segment_id)

  async function linkMenu(richMenuUuid: string): Promise<{ ok: true; lineId: string } | { ok: false; err: string }> {
    const { data: menu } = await admin
      .from('line_messaging_rich_menus')
      .select('line_rich_menu_id, enabled')
      .eq('id', richMenuUuid)
      .eq('service_id', serviceId)
      .maybeSingle()

    if (!menu?.line_rich_menu_id || !menu.enabled) {
      return { ok: false, err: 'menu_not_ready' }
    }

    const link = await lineBotLinkRichMenuToUser(channelAccessToken, lineUserId, menu.line_rich_menu_id)
    if (!link.ok) return { ok: false, err: link.message }
    return { ok: true, lineId: menu.line_rich_menu_id }
  }

  for (const r of withSegment) {
    const { data: seg } = await admin
      .from('line_messaging_segments')
      .select('definition')
      .eq('id', r.segment_id)
      .eq('service_id', serviceId)
      .maybeSingle()

    if (!seg) continue
    const defParsed = SegmentDefinitionSchema.safeParse(seg.definition ?? {})
    if (!defParsed.success) continue

    const resolved = await resolveSegmentLineUserIds(admin, serviceId, defParsed.data)
    if (resolved.error) continue
    if (!resolved.line_user_ids.includes(lineUserId)) continue

    const res = await linkMenu(r.rich_menu_id)
    if (res.ok) return { linked: res.lineId }
    if (res.err !== 'menu_not_ready') return { error: res.err }
  }

  for (const r of fallbacks) {
    const res = await linkMenu(r.rich_menu_id)
    if (res.ok) return { linked: res.lineId }
    if (res.err !== 'menu_not_ready') return { error: res.err }
  }

  return { skipped: true }
}
