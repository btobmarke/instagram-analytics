import type { SupabaseClient } from '@supabase/supabase-js'

export type ConversionCountRow = {
  definition_id: string
  name: string
  match_trigger_type: string
  conversion_count: number
}

/**
 * G2: 期間内に match_trigger_type のイベントが発生したコンタクト数（重複除く）
 */
export async function buildConversionReport(
  admin: SupabaseClient,
  serviceId: string,
  opts: { from: string; to: string },
): Promise<{ data: ConversionCountRow[]; error?: string }> {
  const fromMs = Date.parse(opts.from)
  const toMs = Date.parse(opts.to)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
    return { data: [], error: 'invalid_date_range' }
  }

  const { data: defs, error: dErr } = await admin
    .from('line_messaging_conversion_definitions')
    .select('id, name, match_trigger_type')
    .eq('service_id', serviceId)
    .eq('enabled', true)

  if (dErr) return { data: [], error: dErr.message }

  const rows: ConversionCountRow[] = []

  for (const d of defs ?? []) {
    const { data: evs, error: eErr } = await admin
      .from('line_messaging_events')
      .select('contact_id')
      .eq('service_id', serviceId)
      .eq('trigger_type', d.match_trigger_type)
      .gte('occurred_at', opts.from)
      .lte('occurred_at', opts.to)
      .not('contact_id', 'is', null)

    if (eErr) return { data: [], error: eErr.message }

    const contacts = new Set(
      (evs ?? []).map((r) => r.contact_id).filter((id): id is string => Boolean(id)),
    )

    rows.push({
      definition_id: d.id,
      name: d.name,
      match_trigger_type: d.match_trigger_type,
      conversion_count: contacts.size,
    })
  }

  return { data: rows }
}
