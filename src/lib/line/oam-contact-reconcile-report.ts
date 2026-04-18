import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_CONTACTS = 8000
const IN_CHUNK = 150

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export type OamContactReconcileReport = {
  service_id: string
  rewardcard_ids: string[]
  contacts_followed_total: number
  contacts_sampled: number
  contacts_truncated: boolean
  contacts_with_any_oam_txn: number
  match_rate_in_sample: number | null
}

/**
 * Messaging contacts（友だち）の line_user_id が、同一サービスの OAM 付与ログの customer_id として
 * 少なくとも1件存在する割合を概算する（大量 contacts 時はサンプル上限あり）。
 */
export async function buildOamContactReconcileReport(
  admin: SupabaseClient,
  serviceId: string,
): Promise<{ data: OamContactReconcileReport; error?: string }> {
  const { data: cards, error: cErr } = await admin
    .from('line_oam_rewardcards')
    .select('id')
    .eq('service_id', serviceId)

  if (cErr) return { data: emptyReport(serviceId, []), error: cErr.message }

  const rewardcardIds = (cards ?? []).map((r) => r.id)
  if (rewardcardIds.length === 0) {
    const { count: n } = await admin
      .from('line_messaging_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('service_id', serviceId)
      .eq('is_followed', true)

    return {
      data: {
        service_id: serviceId,
        rewardcard_ids: [],
        contacts_followed_total: n ?? 0,
        contacts_sampled: 0,
        contacts_truncated: false,
        contacts_with_any_oam_txn: 0,
        match_rate_in_sample: null,
      },
    }
  }

  const { count: totalFollowed, error: cntErr } = await admin
    .from('line_messaging_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('service_id', serviceId)
    .eq('is_followed', true)

  if (cntErr) return { data: emptyReport(serviceId, rewardcardIds), error: cntErr.message }

  const total = totalFollowed ?? 0
  const truncated = total > MAX_CONTACTS

  const { data: contactRows, error: coErr } = await admin
    .from('line_messaging_contacts')
    .select('line_user_id')
    .eq('service_id', serviceId)
    .eq('is_followed', true)
    .order('line_user_id')
    .limit(MAX_CONTACTS)

  if (coErr) return { data: emptyReport(serviceId, rewardcardIds), error: coErr.message }

  const lineUserIds = (contactRows ?? []).map((r) => r.line_user_id).filter(Boolean)
  const matched = new Set<string>()

  for (const part of chunk(lineUserIds, IN_CHUNK)) {
    if (part.length === 0) continue
    const { data: txRows, error: tErr } = await admin
      .from('line_oam_rewardcard_txns')
      .select('customer_id')
      .in('line_rewardcard_id', rewardcardIds)
      .in('customer_id', part)

    if (tErr) return { data: emptyReport(serviceId, rewardcardIds), error: tErr.message }
    for (const row of txRows ?? []) {
      if (row.customer_id) matched.add(row.customer_id)
    }
  }

  const sample = lineUserIds.length
  const withTxn = lineUserIds.filter((id) => matched.has(id)).length
  const rate = sample > 0 ? withTxn / sample : null

  return {
    data: {
      service_id: serviceId,
      rewardcard_ids: rewardcardIds,
      contacts_followed_total: total,
      contacts_sampled: sample,
      contacts_truncated: truncated,
      contacts_with_any_oam_txn: withTxn,
      match_rate_in_sample: rate,
    },
  }
}

function emptyReport(serviceId: string, rewardcard_ids: string[]): OamContactReconcileReport {
  return {
    service_id: serviceId,
    rewardcard_ids,
    contacts_followed_total: 0,
    contacts_sampled: 0,
    contacts_truncated: false,
    contacts_with_any_oam_txn: 0,
    match_rate_in_sample: null,
  }
}
