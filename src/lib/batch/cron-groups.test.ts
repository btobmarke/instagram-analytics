import { describe, expect, it } from 'vitest'
import { getDueBatchSlugs } from '@/lib/batch/cron-groups'

describe('getDueBatchSlugs', () => {
  it('G2: runs the three daily jobs at their UTC minutes on hour 2', () => {
    const d = new Date(Date.UTC(2026, 0, 5, 2, 0, 0))
    expect(getDueBatchSlugs('g2', d)).toEqual(['lp-aggregate'])
    expect(getDueBatchSlugs('g2', new Date(Date.UTC(2026, 0, 5, 2, 15, 0)))).toEqual([
      'google-ads-daily',
    ])
    expect(getDueBatchSlugs('g2', new Date(Date.UTC(2026, 0, 5, 2, 30, 0)))).toEqual([
      'media-collector',
    ])
  })

  it('G_hourly: insight at :00, story-media :05, story-insight :10, kpi :45', () => {
    const base = new Date(Date.UTC(2026, 0, 5, 14, 0, 0))
    expect(getDueBatchSlugs('g_hourly', base)).toEqual(['insight-collector'])
    expect(getDueBatchSlugs('g_hourly', new Date(Date.UTC(2026, 0, 5, 14, 5, 0)))).toEqual([
      'story-media-collector',
    ])
    expect(getDueBatchSlugs('g_hourly', new Date(Date.UTC(2026, 0, 5, 14, 10, 0)))).toEqual([
      'story-insight-collector',
    ])
    expect(getDueBatchSlugs('g_hourly', new Date(Date.UTC(2026, 0, 5, 14, 45, 0)))).toEqual([
      'kpi-calc',
    ])
  })

  it('G_halfhour: lp-session-cleanup at :00 and :30', () => {
    expect(getDueBatchSlugs('g_halfhour', new Date(Date.UTC(2026, 0, 5, 8, 0, 0)))).toEqual([
      'lp-session-cleanup',
    ])
    expect(getDueBatchSlugs('g_halfhour', new Date(Date.UTC(2026, 0, 5, 8, 30, 0)))).toEqual([
      'lp-session-cleanup',
    ])
  })

  it('G_weekly: Monday UTC ai-analysis 6:00, instagram 7:30', () => {
    // 2026-01-05 is Monday
    expect(
      getDueBatchSlugs('g_weekly', new Date(Date.UTC(2026, 0, 5, 6, 0, 0)))
    ).toEqual(['ai-analysis'])
    expect(
      getDueBatchSlugs('g_weekly', new Date(Date.UTC(2026, 0, 5, 7, 30, 0)))
    ).toEqual(['instagram-velocity-retro'])
    expect(getDueBatchSlugs('g_weekly', new Date(Date.UTC(2026, 0, 5, 6, 30, 0)))).toEqual([])
  })

  it('G_daily_misc: weather at 0 and 12, external 17, metrics 21', () => {
    expect(getDueBatchSlugs('g_daily_misc', new Date(Date.UTC(2026, 0, 5, 0, 0, 0)))).toEqual([
      'weather-sync',
    ])
    expect(getDueBatchSlugs('g_daily_misc', new Date(Date.UTC(2026, 0, 5, 12, 0, 0)))).toEqual([
      'weather-sync',
    ])
    expect(getDueBatchSlugs('g_daily_misc', new Date(Date.UTC(2026, 0, 5, 17, 0, 0)))).toEqual([
      'external-data',
    ])
    expect(getDueBatchSlugs('g_daily_misc', new Date(Date.UTC(2026, 0, 5, 21, 0, 0)))).toEqual([
      'project-metrics-aggregate',
    ])
  })
})
