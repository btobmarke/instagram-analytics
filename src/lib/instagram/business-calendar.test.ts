import { describe, expect, it } from 'vitest'
import {
  eachInstagramBusinessYmdInclusive,
  getInstagramBusinessTodayYmd,
  getInstagramBusinessYesterdayYmd,
  igAccountInsightValueDateFromEndTime,
} from '@/lib/instagram/business-calendar'

describe('business-calendar', () => {
  it('eachInstagramBusinessYmdInclusive lists inclusive calendar days', () => {
    expect(eachInstagramBusinessYmdInclusive('2026-04-22', '2026-04-24')).toEqual([
      '2026-04-22',
      '2026-04-23',
      '2026-04-24',
    ])
    expect(eachInstagramBusinessYmdInclusive('2026-04-24', '2026-04-22')).toEqual([])
  })

  it('getInstagramBusinessYesterdayYmd is one day before today in Tokyo', () => {
    const fixed = new Date('2026-04-24T15:00:00Z') // 2026-04-25 00:00 JST
    expect(getInstagramBusinessTodayYmd(fixed)).toBe('2026-04-25')
    expect(getInstagramBusinessYesterdayYmd(fixed)).toBe('2026-04-24')
  })

  it('igAccountInsightValueDateFromEndTime maps end_time to value_date in Tokyo', () => {
    // 2026-04-25 07:00 UTC = 2026-04-25 16:00 JST → 暦日 2026-04-25 → 前日 2026-04-24
    expect(igAccountInsightValueDateFromEndTime('2026-04-25T07:00:00.000Z')).toBe('2026-04-24')
  })
})
