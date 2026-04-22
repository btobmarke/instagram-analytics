import { describe, expect, it, vi } from 'vitest'
import type { InstagramClient } from '@/lib/instagram/client'
import { upsertActiveStoriesPages } from '@/lib/batch/sync-instagram-stories-media'

describe('upsertActiveStoriesPages', () => {
  it('一覧取得が失敗したとき failed を増やし listFetchFailed を立てる', async () => {
    const igClient = {
      getStoriesList: vi.fn().mockRejectedValue(new Error('Instagram API Error 403: permission')),
    } as unknown as InstagramClient

    const upsertRow = vi.fn().mockResolvedValue(undefined)
    const r = await upsertActiveStoriesPages(igClient, upsertRow, {
      accountId: 'acc-1',
      logPrefix: 'test',
    })

    expect(r.processed).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.listFetchFailed).toBe(true)
    expect(r.listFetchErrorMessage).toContain('403')
    expect(r.rateLimitStoppedEarly).toBe(false)
    expect(upsertRow).not.toHaveBeenCalled()
  })

  it('2ページ目でレート制限なら rateLimitStoppedEarly と既存分の processed を返す', async () => {
    const page1Paging = { next: 'https://g', cursors: { after: 'c1' } }
    const igClient = {
      getStoriesList: vi
        .fn()
        .mockResolvedValueOnce({
          data: { data: [{ id: 'm1' }], paging: page1Paging },
          paging: page1Paging,
          rateUsage: { call_count: 10, total_time: 10, total_cputime: 10 },
        })
        .mockResolvedValueOnce({
          data: { data: [], paging: {} },
          paging: {},
          rateUsage: { call_count: 99, total_time: 10, total_cputime: 10 },
        }),
    } as unknown as InstagramClient

    const upsertRow = vi.fn().mockResolvedValue(undefined)
    const r = await upsertActiveStoriesPages(igClient, upsertRow, {
      accountId: 'acc-2',
      logPrefix: 'test',
    })

    expect(r.processed).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.listFetchFailed).toBe(false)
    expect(r.rateLimitStoppedEarly).toBe(true)
    expect(upsertRow).toHaveBeenCalledTimes(1)
  })

  it('行 upsert 失敗は failed に含め一覧取得は成功扱い', async () => {
    const igClient = {
      getStoriesList: vi.fn().mockResolvedValue({
        data: { data: [{ id: 'm1' }], paging: {} },
        paging: {},
        rateUsage: null,
      }),
    } as unknown as InstagramClient

    const upsertRow = vi.fn().mockRejectedValue(new Error('db upsert'))
    const r = await upsertActiveStoriesPages(igClient, upsertRow, {
      accountId: 'acc-3',
      logPrefix: 'test',
    })

    expect(r.processed).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.listFetchFailed).toBe(false)
    expect(r.listFetchErrorMessage).toBeNull()
  })
})
