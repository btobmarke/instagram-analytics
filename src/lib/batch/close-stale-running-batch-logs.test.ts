import { describe, expect, it, vi } from 'vitest'
import { closeStaleRunningBatchLogs } from '@/lib/batch/close-stale-running-batch-logs'

function createMockAdmin(rowsByJob: Record<string, Array<{ id: string; started_at: string }>>) {
  const chains: Array<{ update: ReturnType<typeof vi.fn> }> = []
  const from = vi.fn(() => {
    let currentJobName: string | null = null
    let startedBefore: string | null = null

    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((col: string, val: unknown) => {
        if (col === 'job_name') currentJobName = String(val)
        return chain
      }),
      is: vi.fn().mockReturnThis(),
      lt: vi.fn((col: string, val: unknown) => {
        if (col === 'started_at') startedBefore = String(val)
        return chain
      }),
      limit: vi.fn(async () => {
        const job = currentJobName
        const before = startedBefore
        currentJobName = null
        startedBefore = null
        if (!job || !before) return { data: [], error: null }
        const rows = rowsByJob[job] ?? []
        return {
          data: rows.filter(r => r.started_at < before),
          error: null,
        }
      }),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    }
    chains.push(chain)
    return chain
  })
  return { from, chains }
}

describe('closeStaleRunningBatchLogs', () => {
  it('20分以上前の running を failed に更新する', async () => {
    const oldIso = new Date(Date.now() - 25 * 60 * 1000).toISOString()
    const { chains, ...admin } = createMockAdmin({
      hourly_media_insight_collector: [{ id: 'log-1', started_at: oldIso }],
    })

    await closeStaleRunningBatchLogs(
      admin as unknown as Parameters<typeof closeStaleRunningBatchLogs>[0],
      ['hourly_media_insight_collector'],
      20 * 60 * 1000
    )

    const updateChain = chains.find(c => c.update.mock.calls.length > 0)
    expect(updateChain).toBeDefined()
    const payload = updateChain!.update.mock.calls[0][0] as { status: string; error_message?: string }
    expect(payload.status).toBe('failed')
    expect(payload.error_message).toContain('Stale running')
  })

  it('閾値より新しい running は触らない', async () => {
    const recentIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { chains, ...admin } = createMockAdmin({
      hourly_media_insight_collector: [{ id: 'log-2', started_at: recentIso }],
    })

    await closeStaleRunningBatchLogs(
      admin as unknown as Parameters<typeof closeStaleRunningBatchLogs>[0],
      ['hourly_media_insight_collector'],
      20 * 60 * 1000
    )

    expect(chains.every(c => c.update.mock.calls.length === 0)).toBe(true)
  })
})
