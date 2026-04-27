import { describe, expect, it } from 'vitest'
import {
  dedupeGbpSearchKeywordMonthlyUpsertRows,
  gbpSearchKeywordMonthlyCanonical,
} from '@/lib/gbp/api'

describe('gbpSearchKeywordMonthlyCanonical', () => {
  it('trims and NFKC-normalizes full-width digits to half-width', () => {
    const a = gbpSearchKeywordMonthlyCanonical(' ｶﾌｪ １２３ ')
    const b = gbpSearchKeywordMonthlyCanonical(' カフェ 123 ')
    expect(a).toBe(b)
  })

  it('returns empty for blank', () => {
    expect(gbpSearchKeywordMonthlyCanonical('   ')).toBe('')
  })
})

describe('dedupeGbpSearchKeywordMonthlyUpsertRows', () => {
  it('merges rows that normalize to the same keyword', () => {
    const base = {
      gbp_site_id: 's1',
      year: 2026,
      month: 3,
      impressions: 10 as number | null,
      threshold: null as string | null,
      updated_at: 't',
    }
    const rows = dedupeGbpSearchKeywordMonthlyUpsertRows([
      { ...base, search_keyword: 'ｶﾌｪ', impressions: 5, threshold: null },
      { ...base, search_keyword: 'カフェ', impressions: 10, threshold: null },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.search_keyword).toBe('カフェ')
    expect(rows[0]?.impressions).toBe(10)
  })
})
