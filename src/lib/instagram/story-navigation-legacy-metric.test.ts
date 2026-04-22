import { describe, expect, it } from 'vitest'
import { legacyStoryMetricCodeFromNavigationDimension } from '@/lib/instagram/story-navigation-legacy-metric'

describe('legacyStoryMetricCodeFromNavigationDimension', () => {
  it('maps v22 navigation breakdown dimensions to legacy metric codes', () => {
    expect(legacyStoryMetricCodeFromNavigationDimension('tap_forward')).toBe('taps_forward')
    expect(legacyStoryMetricCodeFromNavigationDimension('TAP_FORWARD')).toBe('taps_forward')
    expect(legacyStoryMetricCodeFromNavigationDimension('tap_back')).toBe('taps_back')
    expect(legacyStoryMetricCodeFromNavigationDimension('tap_exit')).toBe('exits')
  })

  it('returns null for unrelated dimensions', () => {
    expect(legacyStoryMetricCodeFromNavigationDimension('swipe_forward')).toBeNull()
    expect(legacyStoryMetricCodeFromNavigationDimension('')).toBeNull()
  })
})
