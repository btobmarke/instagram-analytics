import { describe, expect, it } from 'vitest'
import {
  salesHourlySlotsForRevenueSum,
  salesHourlySlotsForRevenueSumByDay,
  slotLabelLooksHourly,
} from './sales-slot-aggregate'

describe('salesHourlySlotsForRevenueSum', () => {
  it('drops all row when hourly slots exist (avoid double count)', () => {
    const slots = [
      { slot_label: '11:00-12:00' },
      { slot_label: 'all' },
    ]
    expect(salesHourlySlotsForRevenueSum(slots)).toEqual([{ slot_label: '11:00-12:00' }])
  })

  it('keeps all when no hourly pattern', () => {
    const slots = [{ slot_label: 'all' }]
    expect(salesHourlySlotsForRevenueSum(slots)).toEqual(slots)
  })

  it('recognizes 時間帯: prefix labels', () => {
    expect(slotLabelLooksHourly('時間帯:10:00-11:00')).toBe(true)
  })

  it('salesHourlySlotsForRevenueSumByDay: only drops all per sales_day_id', () => {
    const mixed = [
      { sales_day_id: 'day-a', slot_label: 'all' },
      { sales_day_id: 'day-b', slot_label: '11:00-12:00' },
      { sales_day_id: 'day-b', slot_label: 'all' },
    ]
    const out = salesHourlySlotsForRevenueSumByDay(mixed)
    expect(out.map(s => `${s.sales_day_id}:${s.slot_label}`)).toEqual([
      'day-a:all',
      'day-b:11:00-12:00',
    ])
  })
})
