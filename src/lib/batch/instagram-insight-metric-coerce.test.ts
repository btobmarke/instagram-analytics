import { describe, expect, it } from 'vitest'
import {
  accountTimeSeriesPointValueOrZero,
  accountTotalValueScalarOrZero,
  coerceStoryInsightBigintValue,
  mediaInsightValueOrZero,
  onlineFollowersScalarOrZero,
} from '@/lib/batch/instagram-insight-metric-coerce'

describe('instagram-insight-metric-coerce', () => {
  it('mediaInsightValueOrZero', () => {
    expect(mediaInsightValueOrZero({ values: [{ value: 0 }] })).toBe(0)
    expect(mediaInsightValueOrZero({ value: '5' })).toBe(5)
    expect(mediaInsightValueOrZero({ total_value: { value: 2 } })).toBe(2)
    expect(mediaInsightValueOrZero({ name: 'x' } as never)).toBe(0)
  })

  it('accountTimeSeriesPointValueOrZero', () => {
    expect(accountTimeSeriesPointValueOrZero(1)).toBe(1)
    expect(accountTimeSeriesPointValueOrZero({ a: 1, b: 2 })).toBe(3)
    expect(accountTimeSeriesPointValueOrZero(null)).toBe(0)
  })

  it('accountTotalValueScalarOrZero', () => {
    expect(accountTotalValueScalarOrZero(undefined)).toBe(0)
    expect(accountTotalValueScalarOrZero('10')).toBe(10)
  })

  it('onlineFollowersScalarOrZero', () => {
    expect(onlineFollowersScalarOrZero({ '0': 0, '1': 0 })).toBe(0)
    expect(onlineFollowersScalarOrZero({ '0': 1, '1': 2 })).toBe(3)
  })

  it('coerceStoryInsightBigintValue', () => {
    expect(coerceStoryInsightBigintValue('0')).toBe(0)
    expect(coerceStoryInsightBigintValue(null)).toBe(0)
    expect(coerceStoryInsightBigintValue('not-a-number')).toBe(0)
  })
})
