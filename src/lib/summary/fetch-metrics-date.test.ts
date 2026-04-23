import { describe, expect, it } from 'vitest'
import { parseSqlDateToYmd } from './fetch-metrics'

describe('parseSqlDateToYmd', () => {
  it('DATE 相当の先頭 YYYY-MM-DD を取る', () => {
    expect(parseSqlDateToYmd('2026-04-22')).toBe('2026-04-22')
    expect(parseSqlDateToYmd('  2026-04-22  ')).toBe('2026-04-22')
    expect(parseSqlDateToYmd('2026-04-22T00:00:00+00:00')).toBe('2026-04-22')
  })
  it('不正値は null', () => {
    expect(parseSqlDateToYmd(null)).toBeNull()
    expect(parseSqlDateToYmd('')).toBeNull()
    expect(parseSqlDateToYmd('not-a-date')).toBeNull()
  })
})
