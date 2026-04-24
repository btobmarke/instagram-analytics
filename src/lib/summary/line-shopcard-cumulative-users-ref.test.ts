import { describe, expect, it } from 'vitest'
import {
  encodeLineShopcardCumulativeUsersRef,
  parseLineShopcardCumulativeUsersRef,
  pointMatchesCumulativeSlice,
} from '@/lib/summary/line-shopcard-cumulative-users-ref'

describe('line-shopcard cumulative users ref', () => {
  it('encodes and parses round-trip', () => {
    const ref = encodeLineShopcardCumulativeUsersRef('eq', 3)
    expect(ref).toBe('line_oam_shopcard_point.cumulative_users@eq:3')
    expect(parseLineShopcardCumulativeUsersRef(ref)).toEqual({ op: 'eq', threshold: 3 })
  })

  it('pointMatchesCumulativeSlice', () => {
    expect(pointMatchesCumulativeSlice(3, 'eq', 3)).toBe(true)
    expect(pointMatchesCumulativeSlice(2, 'eq', 3)).toBe(false)
    expect(pointMatchesCumulativeSlice(3, 'gte', 3)).toBe(true)
    expect(pointMatchesCumulativeSlice(2, 'gte', 3)).toBe(false)
    expect(pointMatchesCumulativeSlice(3, 'lte', 3)).toBe(true)
    expect(pointMatchesCumulativeSlice(4, 'lte', 3)).toBe(false)
    expect(pointMatchesCumulativeSlice(4, 'gt', 3)).toBe(true)
    expect(pointMatchesCumulativeSlice(3, 'gt', 3)).toBe(false)
    expect(pointMatchesCumulativeSlice(2, 'lt', 3)).toBe(true)
  })
})
