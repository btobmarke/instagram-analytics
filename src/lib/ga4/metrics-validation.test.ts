import { describe, expect, it } from 'vitest'
import { validateRunReportMetrics } from '@/lib/ga4/metrics-validation'

describe('validateRunReportMetrics', () => {
  it('11 メトリクスで例外', () => {
    const metrics = Array.from({ length: 11 }, (_, i) => ({ name: `m${i}` }))
    expect(() => validateRunReportMetrics(metrics, 't')).toThrow(/10 個を超えています/)
  })

  it('同名メトリクスで例外', () => {
    expect(() =>
      validateRunReportMetrics([{ name: 'sessions' }, { name: 'sessions' }], 't')
    ).toThrow(/sessions/)
  })

  it('conversions と keyEvents の併用で例外', () => {
    expect(() =>
      validateRunReportMetrics([{ name: 'conversions' }, { name: 'keyEvents' }], 't')
    ).toThrow(/併用できません/)
  })

  it('正常な配列は通る', () => {
    expect(() =>
      validateRunReportMetrics(
        [
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'conversions' },
        ],
        'page'
      )
    ).not.toThrow()
  })
})
