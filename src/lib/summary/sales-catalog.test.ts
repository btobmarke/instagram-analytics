import { describe, expect, it } from 'vitest'
import {
  getMetricCatalog,
  getMetricCatalogForProjectAggregate,
} from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

describe('getMetricCatalog("sales")', () => {
  it('exposes sales_rollup metrics for batch and unified-summary', () => {
    const cards = getMetricCatalog('sales')
    expect(cards.length).toBe(5)
    const ids = cards.map(c => c.id)
    expect(ids).toContain('sales_rollup.total_amount_with_tax')
    expect(ids).toContain('sales_rollup.total_amount_without_tax')
    expect(ids).toContain('sales_rollup.slot_count')
    expect(ids).toContain('sales_rollup.order_count')
    expect(ids).toContain('sales_rollup.rest_break_slot_count')
  })
})

describe('getMetricCatalogForProjectAggregate("google_ads")', () => {
  it('excludes YOUR_* placeholder slice metrics for batch and unified-summary', () => {
    const agg = getMetricCatalogForProjectAggregate('google_ads')
    const full = getMetricCatalog('google_ads')
    expect(agg.length).toBeLessThan(full.length)
    expect(agg.every((c) => !c.id.includes('YOUR_'))).toBe(true)
    expect(agg.map((c) => c.id)).toContain('google_ads_campaign_daily.impressions')
    expect(agg.map((c) => c.id)).toContain('google_ads_campaign_daily.ctr')
    expect(full.some((c) => c.id.includes('YOUR_CAMPAIGN_ID'))).toBe(true)
  })
})
