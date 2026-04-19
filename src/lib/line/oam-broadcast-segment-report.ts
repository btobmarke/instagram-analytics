import type { SupabaseClient } from '@supabase/supabase-js'
import { SegmentDefinitionSchema } from '@/lib/line/segment-definition'
import { resolveSegmentLineUserIds } from '@/lib/line/evaluate-segment'

export type OamBroadcastSegmentRow = {
  segment_id: string | null
  segment_name: string | null
  contacts_in_segment: number
  contacts_with_txn: number
  txn_rate: number | null
}

/**
 * G3: 指定期間の OAM 付与（line_oam_rewardcard_txns）とセグメント所属の突合
 */
export async function buildOamBroadcastSegmentReport(
  admin: SupabaseClient,
  serviceId: string,
  opts: { from: string; to: string },
): Promise<{ data: OamBroadcastSegmentRow[]; error?: string }> {
  const fromMs = Date.parse(opts.from)
  const toMs = Date.parse(opts.to)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
    return { data: [], error: 'invalid_date_range' }
  }

  const { data: cards, error: cErr } = await admin
    .from('line_oam_rewardcards')
    .select('id')
    .eq('service_id', serviceId)

  if (cErr) return { data: [], error: cErr.message }
  const rewardcardIds = (cards ?? []).map((r) => r.id)
  if (rewardcardIds.length === 0) {
    return {
      data: [
        {
          segment_id: null,
          segment_name: '（全友だち）',
          contacts_in_segment: 0,
          contacts_with_txn: 0,
          txn_rate: null,
        },
      ],
    }
  }

  const { data: segments, error: sErr } = await admin
    .from('line_messaging_segments')
    .select('id, name, definition')
    .eq('service_id', serviceId)

  if (sErr) return { data: [], error: sErr.message }

  const rows: OamBroadcastSegmentRow[] = []

  const computeForLineUserIds = async (
    name: string,
    segmentId: string | null,
    lineUserIds: string[],
  ): Promise<string | undefined> => {
    const unique = [...new Set(lineUserIds)]
    const n = unique.length
    if (n === 0) {
      rows.push({
        segment_id: segmentId,
        segment_name: name,
        contacts_in_segment: 0,
        contacts_with_txn: 0,
        txn_rate: null,
      })
      return undefined
    }

    const IN_CHUNK = 120
    const withTxn = new Set<string>()
    for (let i = 0; i < unique.length; i += IN_CHUNK) {
      const part = unique.slice(i, i + IN_CHUNK)
      const { data: txRows, error: tErr } = await admin
        .from('line_oam_rewardcard_txns')
        .select('customer_id')
        .in('line_rewardcard_id', rewardcardIds)
        .gte('txn_datetime', opts.from)
        .lte('txn_datetime', opts.to)
        .in('customer_id', part)

      if (tErr) {
        return tErr.message
      }
      for (const row of txRows ?? []) {
        if (row.customer_id) withTxn.add(row.customer_id)
      }
    }

    const matched = unique.filter((id) => withTxn.has(id)).length
    rows.push({
      segment_id: segmentId,
      segment_name: name,
      contacts_in_segment: n,
      contacts_with_txn: matched,
      txn_rate: n > 0 ? matched / n : null,
    })
    return undefined
  }

  for (const seg of segments ?? []) {
    const defParsed = SegmentDefinitionSchema.safeParse(seg.definition ?? {})
    if (!defParsed.success) continue
    const resolved = await resolveSegmentLineUserIds(admin, serviceId, defParsed.data)
    if (resolved.error) continue
    const err = await computeForLineUserIds(seg.name, seg.id, resolved.line_user_ids)
    if (err) return { data: [], error: err }
  }

  const { data: allFollowed } = await admin
    .from('line_messaging_contacts')
    .select('line_user_id')
    .eq('service_id', serviceId)
    .eq('is_followed', true)

  const allIds = (allFollowed ?? []).map((r) => r.line_user_id).filter(Boolean)
  const errAll = await computeForLineUserIds('（全友だち）', null, allIds)
  if (errAll) return { data: [], error: errAll }

  rows.sort((a, b) => (b.txn_rate ?? 0) - (a.txn_rate ?? 0))
  return { data: rows }
}
