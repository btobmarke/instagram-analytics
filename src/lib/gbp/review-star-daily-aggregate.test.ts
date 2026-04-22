import { describe, it, expect } from 'vitest'
import { reviewDateKeyJst, starRatingToBucket, aggregateReviewsToDailyStarCounts } from '@/lib/gbp/review-star-daily-aggregate'

describe('reviewDateKeyJst', () => {
  it('uses Asia/Tokyo calendar date', () => {
    expect(reviewDateKeyJst('2025-04-20T15:00:00Z')).toBe('2025-04-21')
  })
})

describe('starRatingToBucket', () => {
  it('maps known ratings', () => {
    expect(starRatingToBucket('FIVE')).toBe('FIVE')
    expect(starRatingToBucket('ONE')).toBe('ONE')
  })
  it('maps unspecified and empty to NONE', () => {
    expect(starRatingToBucket('STAR_RATING_UNSPECIFIED')).toBe('NONE')
    expect(starRatingToBucket(null)).toBe('NONE')
    expect(starRatingToBucket('')).toBe('NONE')
  })
  it('maps unknown strings to NONE', () => {
    expect(starRatingToBucket('SIX')).toBe('NONE')
  })
})

describe('aggregateReviewsToDailyStarCounts', () => {
  it('counts per day and star', () => {
    const m = aggregateReviewsToDailyStarCounts([
      { create_time: '2025-04-21T10:00:00Z', star_rating: 'FIVE' },
      { create_time: '2025-04-21T11:00:00Z', star_rating: 'FIVE' },
      { create_time: '2025-04-21T12:00:00Z', star_rating: 'STAR_RATING_UNSPECIFIED' },
      { create_time: '2025-04-21T13:00:00Z', star_rating: null },
    ])
    const d = m.get('2025-04-21')
    expect(d).toBeDefined()
    expect(d!.stars_5).toBe(2)
    expect(d!.stars_none).toBe(2)
  })
})
