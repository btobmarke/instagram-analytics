/**
 * サマリーテンプレート編集・表示で横軸ラベル列を揃える
 */

import { buildPeriods, type TimeUnit } from '@/lib/summary/build-periods'
import { generateCustomRangePeriod, generateJstDayPeriodLabels } from '@/lib/summary/jst-periods'

export function templateTimeHeaderLabels(
  unit: TimeUnit,
  count: number,
  /** custom_range の集計期間 */
  aggregateRangeStart?: string | null,
  aggregateRangeEnd?: string | null,
  /** day/week/month の表示期間（横軸の列範囲） */
  displayRangeStart?: string | null,
  displayRangeEnd?: string | null,
): string[] {
  if (unit === 'custom_range') {
    if (aggregateRangeStart && aggregateRangeEnd) {
      return [generateCustomRangePeriod(aggregateRangeStart, aggregateRangeEnd).label]
    }
    return ['（開始・終了日を設定）']
  }

  const ds = displayRangeStart?.slice(0, 10)
  const de = displayRangeEnd?.slice(0, 10)
  if (ds && de && ds <= de) {
    const p = buildPeriods(unit, count, ds, de)
    if (!('error' in p)) return p.map((x) => x.label)
  }

  if (unit === 'day') return generateJstDayPeriodLabels(count)

  const headers: string[] = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    switch (unit) {
      case 'hour':
        d.setHours(d.getHours() - i, 0, 0, 0)
        headers.push(`${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`)
        break
      case 'week': {
        const s = new Date(d)
        s.setDate(d.getDate() - i * 7)
        headers.push(`${s.getMonth() + 1}/${s.getDate()}週`)
        break
      }
      case 'month':
        d.setMonth(d.getMonth() - i)
        headers.push(`${d.getFullYear()}/${d.getMonth() + 1}`)
        break
      default:
        break
    }
  }
  return headers
}
