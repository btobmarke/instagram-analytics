import { describe, expect, it } from 'vitest'
import { encodeSummaryConditionalRef, parseSummaryConditionalRef } from '@/lib/summary/summary-conditional-ref'

describe('summary-conditional-ref', () => {
  it('round-trips payload', () => {
    const ref = encodeSummaryConditionalRef({
      definitionId: 'line_oam_shopcard_point_cond_sum',
      compareField: 'point',
      compareOp: 'eq',
      compareValue: 3,
      sumField: 'users',
    })
    expect(ref.startsWith('summary@cond:v1:')).toBe(true)
    const p = parseSummaryConditionalRef(ref)
    expect(p).toEqual({
      definitionId: 'line_oam_shopcard_point_cond_sum',
      params: {
        compareField: 'point',
        compareOp: 'eq',
        compareValue: 3,
        sumField: 'users',
      },
    })
  })
})
