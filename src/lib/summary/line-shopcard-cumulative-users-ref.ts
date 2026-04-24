import type { CumulativeUsersCompareOp } from '@/lib/summary/formula-types'

/** fetchMetricsByRefs / rawData のキー（line_oam_shopcard_point の仮想フィールド） */
export const LINE_SHOPCARD_CUMULATIVE_USERS_REF_PREFIX = 'line_oam_shopcard_point.cumulative_users@'

export function encodeLineShopcardCumulativeUsersRef(
  op: CumulativeUsersCompareOp,
  threshold: number,
): string {
  return `${LINE_SHOPCARD_CUMULATIVE_USERS_REF_PREFIX}${op}:${threshold}`
}

export function parseLineShopcardCumulativeUsersRef(ref: string): {
  op: CumulativeUsersCompareOp
  threshold: number
} | null {
  if (!ref.startsWith(LINE_SHOPCARD_CUMULATIVE_USERS_REF_PREFIX)) return null
  const rest = ref.slice(LINE_SHOPCARD_CUMULATIVE_USERS_REF_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon < 0) return null
  const op = rest.slice(0, colon) as CumulativeUsersCompareOp
  const threshold = Number(rest.slice(colon + 1))
  if (!['eq', 'gte', 'lte', 'gt', 'lt'].includes(op) || !Number.isFinite(threshold)) return null
  return { op, threshold }
}

export function pointMatchesCumulativeSlice(
  point: number,
  op: CumulativeUsersCompareOp,
  threshold: number,
): boolean {
  switch (op) {
    case 'eq':
      return point === threshold
    case 'gte':
      return point >= threshold
    case 'lte':
      return point <= threshold
    case 'gt':
      return point > threshold
    case 'lt':
      return point < threshold
    default:
      return false
  }
}
