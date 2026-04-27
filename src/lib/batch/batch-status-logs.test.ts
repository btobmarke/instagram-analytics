import { describe, expect, it } from 'vitest'
import type { BatchJobLog } from '@/types'
import { mergeBatchJobLogGroups } from '@/lib/batch/batch-status-logs'

function log(
  id: string,
  job_name: string,
  started_at: string,
  overrides: Partial<BatchJobLog> = {},
): BatchJobLog {
  return {
    id,
    job_name,
    account_id: null,
    status: 'success',
    records_processed: 1,
    records_failed: 0,
    error_message: null,
    started_at,
    finished_at: started_at,
    duration_ms: 100,
    ...overrides,
  }
}

describe('mergeBatchJobLogGroups', () => {
  it('dedupes by id and sorts by started_at desc', () => {
    const a = log('1', 'gbp_daily', '2026-04-26T10:00:00Z')
    const b = log('2', 'hourly_media_insight_collector', '2026-04-26T11:00:00Z')
    const c = log('3', 'gbp_daily', '2026-04-25T10:00:00Z')
    const merged = mergeBatchJobLogGroups([[a, c], [b]])
    expect(merged.map((x) => x.id)).toEqual(['2', '1', '3'])
  })

  it('keeps one row when the same id appears in multiple groups', () => {
    const row = log('x', 'gbp_daily', '2026-04-26T10:00:00Z')
    const merged = mergeBatchJobLogGroups([[row], [row]])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('x')
  })
})
