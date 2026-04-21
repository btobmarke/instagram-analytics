import { describe, expect, it } from 'vitest'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

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
