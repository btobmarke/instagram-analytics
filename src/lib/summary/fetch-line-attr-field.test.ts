import { describe, it, expect } from 'vitest'
import { parseLineOamFriendsAttrField } from '@/lib/summary/fetch-metrics'

describe('parseLineOamFriendsAttrField', () => {
  it('parses slice spec', () => {
    const s = parseLineOamFriendsAttrField('percentage@@gender=male@@age=20〜24歳')
    expect(s.column).toBe('percentage')
    expect(s.genderFilter).toBe('male')
    expect(s.ageFilter).toBe('20〜24歳')
  })
})
