import { describe, expect, it } from 'vitest'
import { addCalendarDaysIso, utcDateFromYmd, ymdToParts } from '@/lib/gbp/jst-calendar'

describe('addCalendarDaysIso', () => {
  it('subtracts days across month boundary', () => {
    expect(addCalendarDaysIso('2026-04-03', -2)).toBe('2026-04-01')
  })

  it('adds days', () => {
    expect(addCalendarDaysIso('2026-04-01', 1)).toBe('2026-04-02')
  })
})

describe('utcDateFromYmd', () => {
  it('matches UTC calendar components', () => {
    const d = utcDateFromYmd('2026-04-26')
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(3)
    expect(d.getUTCDate()).toBe(26)
  })
})

describe('ymdToParts', () => {
  it('parses', () => {
    expect(ymdToParts('2026-01-05')).toEqual({ year: 2026, month: 1, day: 5 })
  })
})
