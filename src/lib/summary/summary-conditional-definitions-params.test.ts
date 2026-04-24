import { describe, expect, it } from 'vitest'
import { LineRewardcardTableCondAggParamsSchema } from '@/lib/summary/summary-conditional-definitions'

describe('LineRewardcardTableCondAggParamsSchema', () => {
  it('rejects sumField equal to compareField', () => {
    const r = LineRewardcardTableCondAggParamsSchema.safeParse({
      table: 'line_oam_shopcard_point',
      compareField: 'point',
      compareOp: 'eq',
      compareValue: 1,
      aggregate: 'sum',
      sumField: 'point',
    })
    expect(r.success).toBe(false)
  })

  it('accepts row_count without sumField', () => {
    const r = LineRewardcardTableCondAggParamsSchema.safeParse({
      table: 'line_oam_shopcard_status',
      compareField: 'valid_cards',
      compareOp: 'gte',
      compareValue: 10,
      aggregate: 'row_count',
    })
    expect(r.success).toBe(true)
  })
})
