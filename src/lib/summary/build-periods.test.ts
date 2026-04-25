import { describe, it, expect } from 'vitest'
import { buildPeriods, MAX_SUMMARY_PERIODS } from './build-periods'

describe('buildPeriods', () => {
  it('generates one label per day for day unit with range', () => {
    const p = buildPeriods('day', 8, '2026-04-01', '2026-04-03')
    expect('error' in p).toBe(false)
    if ('error' in p) return
    expect(p.map((x) => x.label)).toEqual(['4/1', '4/2', '4/3'])
    expect(p.map((x) => x.dateKey)).toEqual(['2026-04-01', '2026-04-02', '2026-04-03'])
  })

  it('rejects too many day columns', () => {
    const start = '2024-01-01'
    const end = '2025-06-30'
    const p = buildPeriods('day', 8, start, end)
    expect('error' in p).toBe(true)
    if (!('error' in p)) return
    expect(p.error).toContain(String(MAX_SUMMARY_PERIODS))
  })
})
