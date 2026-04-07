import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = createSupabaseAdminClient()

  // ── 1. フレンド数日次（直近60日）──────────────────────────────
  const { data: friendsDaily } = await supabase
    .from('line_oam_friends_daily')
    .select('date, contacts, target_reaches, blocks')
    .eq('service_id', serviceId)
    .order('date', { ascending: false })
    .limit(60)

  const friendsDailySorted = (friendsDaily ?? []).reverse()

  // 最新 / 前日比
  const latest    = friendsDailySorted[friendsDailySorted.length - 1] ?? null
  const prevDay   = friendsDailySorted[friendsDailySorted.length - 2] ?? null
  const contactsDiff =
    latest && prevDay && latest.contacts != null && prevDay.contacts != null
      ? latest.contacts - prevDay.contacts
      : null

  // ── 2. フレンド属性（最新日のスナップショット）────────────────
  const { data: attrLatestDate } = await supabase
    .from('line_oam_friends_attr')
    .select('date')
    .eq('service_id', serviceId)
    .order('date', { ascending: false })
    .limit(1)
    .single()

  let friendsAttr: { gender: string | null; age: string | null; percentage: number | null }[] = []
  if (attrLatestDate?.date) {
    const { data } = await supabase
      .from('line_oam_friends_attr')
      .select('gender, age, percentage')
      .eq('service_id', serviceId)
      .eq('date', attrLatestDate.date)
      .order('gender')
      .order('age')
    friendsAttr = data ?? []
  }

  // ── 3. リワードカード一覧 ─────────────────────────────────────
  const { data: rewardcards } = await supabase
    .from('line_oam_rewardcards')
    .select('id, rewardcard_id, name, is_active')
    .eq('service_id', serviceId)
    .order('created_at')

  // ── 4. リワードカードごとのショップカードステータス（最新日）──
  const cardSummaries = await Promise.all(
    (rewardcards ?? []).map(async (card) => {
      // 最新日のステータス行
      const { data: statusRows } = await supabase
        .from('line_oam_shopcard_status')
        .select('date, name, valid_cards, issued_cards, vouchers_awarded, vouchers_used')
        .eq('line_rewardcard_id', card.id)
        .order('date', { ascending: false })
        .limit(5)

      // 取引件数（直近30日）
      const since30 = new Date()
      since30.setDate(since30.getDate() - 30)
      const { count: txnCount30 } = await supabase
        .from('line_oam_rewardcard_txns')
        .select('id', { count: 'exact', head: true })
        .eq('line_rewardcard_id', card.id)
        .gte('txn_datetime', since30.toISOString())

      // ポイント分布（最新日）
      const { data: pointDist } = await supabase
        .from('line_oam_shopcard_point')
        .select('point, users')
        .eq('line_rewardcard_id', card.id)
        .order('date', { ascending: false })
        .order('point', { ascending: true })
        .limit(20)

      return {
        id:           card.id,
        rewardcard_id: card.rewardcard_id,
        name:         card.name,
        is_active:    card.is_active,
        status_rows:  statusRows ?? [],
        txn_count_30: txnCount30 ?? 0,
        point_dist:   pointDist ?? [],
      }
    })
  )

  return NextResponse.json({
    success: true,
    data: {
      friends: {
        latest_contacts:     latest?.contacts ?? null,
        latest_blocks:       latest?.blocks ?? null,
        latest_target_reaches: latest?.target_reaches ?? null,
        contacts_diff:       contactsDiff,
        daily:               friendsDailySorted,
        attr_date:           attrLatestDate?.date ?? null,
        attr:                friendsAttr,
      },
      cards: cardSummaries,
    },
  })
}
