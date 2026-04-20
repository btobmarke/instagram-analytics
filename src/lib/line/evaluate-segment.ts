import type { SupabaseClient } from '@supabase/supabase-js'
import type { SegmentDefinition } from '@/lib/line/segment-definition'

function intersectIds(sets: string[][]): string[] {
  if (sets.length === 0) return []
  let acc = new Set(sets[0])
  for (let i = 1; i < sets.length; i++) {
    const next = new Set(sets[i])
    acc = new Set([...acc].filter((x) => next.has(x)))
  }
  return [...acc]
}

function compareText(op: string, left: string, right: string): boolean {
  const ln = left.trim()
  const rn = right.trim()
  switch (op) {
    case 'eq':
      return ln === rn
    case 'neq':
      return ln !== rn
    case 'contains':
      return ln.includes(rn)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = Number(ln)
      const b = Number(rn)
      if (Number.isNaN(a) || Number.isNaN(b)) return false
      if (op === 'gt') return a > b
      if (op === 'gte') return a >= b
      if (op === 'lt') return a < b
      return a <= b
    }
    default:
      return false
  }
}

async function contactIdsForTag(
  admin: SupabaseClient,
  serviceId: string,
  tagId: string,
): Promise<{ ids: string[]; error?: string }> {
  const { data: tag, error: tErr } = await admin
    .from('line_messaging_tags')
    .select('id')
    .eq('id', tagId)
    .eq('service_id', serviceId)
    .maybeSingle()
  if (tErr) return { ids: [], error: tErr.message }
  if (!tag) return { ids: [], error: 'tag_not_found' }

  const { data: rows, error } = await admin
    .from('line_messaging_contact_tags')
    .select('contact_id')
    .eq('tag_id', tagId)

  if (error) return { ids: [], error: error.message }
  return { ids: (rows ?? []).map((r) => r.contact_id) }
}

/**
 * セグメント定義に一致する line_user_id を返す（サービス内の contacts のみ）
 */
export async function resolveSegmentLineUserIds(
  admin: SupabaseClient,
  serviceId: string,
  definition: SegmentDefinition,
): Promise<{ line_user_ids: string[]; error?: string }> {
  let q = admin
    .from('line_messaging_contacts')
    .select('id, line_user_id, is_followed')
    .eq('service_id', serviceId)

  if (definition.follow_status !== 'all') {
    q = q.eq('is_followed', true)
  }

  const { data: contacts, error: cErr } = await q
  if (cErr) return { line_user_ids: [], error: cErr.message }

  let contactIds = new Set((contacts ?? []).map((c) => c.id))
  const idToLineUser = new Map((contacts ?? []).map((c) => [c.id, c.line_user_id] as const))

  if (definition.tag_ids_any?.length) {
    const union = new Set<string>()
    for (const tagId of definition.tag_ids_any) {
      const r = await contactIdsForTag(admin, serviceId, tagId)
      if (r.error) return { line_user_ids: [], error: r.error }
      for (const id of r.ids) union.add(id)
    }
    contactIds = new Set([...contactIds].filter((id) => union.has(id)))
  }

  if (definition.tag_ids_all?.length) {
    const perTag: string[][] = []
    for (const tagId of definition.tag_ids_all) {
      const r = await contactIdsForTag(admin, serviceId, tagId)
      if (r.error) return { line_user_ids: [], error: r.error }
      perTag.push(r.ids)
    }
    const inter = new Set(intersectIds(perTag))
    contactIds = new Set([...contactIds].filter((id) => inter.has(id)))
  }

  if (definition.tag_ids_none?.length) {
    const union = new Set<string>()
    for (const tagId of definition.tag_ids_none) {
      const r = await contactIdsForTag(admin, serviceId, tagId)
      if (r.error) return { line_user_ids: [], error: r.error }
      for (const id of r.ids) union.add(id)
    }
    contactIds = new Set([...contactIds].filter((id) => !union.has(id)))
  }

  if (definition.attribute_filters?.length) {
    for (const f of definition.attribute_filters) {
      const { data: defRow, error: dErr } = await admin
        .from('line_messaging_attribute_definitions')
        .select('id')
        .eq('id', f.definition_id)
        .eq('service_id', serviceId)
        .maybeSingle()

      if (dErr || !defRow) {
        return { line_user_ids: [], error: 'unknown_attribute_definition' }
      }

      const { data: vals, error: vErr } = await admin
        .from('line_messaging_contact_attribute_values')
        .select('contact_id, value_text')
        .eq('definition_id', f.definition_id)

      if (vErr) return { line_user_ids: [], error: vErr.message }

      const valueByContact = new Map<string, string>()
      for (const row of vals ?? []) {
        valueByContact.set(row.contact_id, row.value_text)
      }

      const next = new Set<string>()
      for (const cid of contactIds) {
        const raw = valueByContact.get(cid)
        const left = raw ?? ''
        let ok: boolean
        if (f.op === 'neq') {
          ok = raw === undefined ? true : compareText('neq', raw, f.value)
        } else if (f.op === 'eq' || f.op === 'contains' || f.op.startsWith('g') || f.op.startsWith('l')) {
          ok = raw !== undefined && compareText(f.op, raw, f.value)
        } else {
          ok = false
        }
        if (ok) next.add(cid)
      }
      contactIds = next
    }
  }

  const line_user_ids = [...contactIds].map((id) => idToLineUser.get(id)).filter(Boolean) as string[]
  return { line_user_ids }
}
