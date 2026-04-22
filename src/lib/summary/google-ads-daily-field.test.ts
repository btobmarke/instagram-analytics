import { describe, expect, it } from 'vitest'
import { parseGoogleAdsDailyField } from './fetch-metrics'

describe('parseGoogleAdsDailyField', () => {
  it('defaults to campaign table when no slice keys', () => {
    const s = parseGoogleAdsDailyField('impressions', 'google_ads_campaign_daily')
    expect(s).toEqual({
      refKey: 'impressions',
      dbTable: 'google_ads_campaign_daily',
      metric: 'impressions',
    })
  })

  it('uses adgroup table when ad_group_id present', () => {
    const s = parseGoogleAdsDailyField('clicks@@ad_group_id=ag1', 'google_ads_adgroup_daily')
    expect(s).toMatchObject({
      refKey: 'clicks@@ad_group_id=ag1',
      dbTable: 'google_ads_adgroup_daily',
      metric: 'clicks',
      adGroupId: 'ag1',
    })
  })

  it('uses keyword table when keyword_id present', () => {
    const s = parseGoogleAdsDailyField('quality_score@@keyword_id=kw9', 'google_ads_keyword_daily')
    expect(s).toMatchObject({
      refKey: 'quality_score@@keyword_id=kw9',
      dbTable: 'google_ads_keyword_daily',
      metric: 'quality_score',
      keywordId: 'kw9',
    })
  })

  it('rejects quality_score without keyword slice', () => {
    expect(parseGoogleAdsDailyField('quality_score', 'google_ads_campaign_daily')).toBeNull()
  })

  it('accepts ctr on campaign logical table', () => {
    const s = parseGoogleAdsDailyField('ctr', 'google_ads_campaign_daily')
    expect(s).toMatchObject({ metric: 'ctr', dbTable: 'google_ads_campaign_daily' })
  })
})
