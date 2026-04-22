import { describe, expect, it, vi } from 'vitest'
import { mergeLatestStoryInsightsIntoPostList } from '@/lib/instagram/post-insight-fact-query'

describe('mergeLatestStoryInsightsIntoPostList', () => {
  it('ストーリー行の insights に ig_story_insight_fact の最新値を反映する', async () => {
    const storyRows = [
      { media_id: 'm1', metric_code: 'reach', value: 100, fetched_at: '2026-01-01T10:00:00Z' },
      { media_id: 'm1', metric_code: 'reach', value: 200, fetched_at: '2026-01-01T11:00:00Z' },
      { media_id: 'm1', metric_code: 'views', value: 50, fetched_at: '2026-01-01T11:00:00Z' },
    ]

    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            in: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve({ data: storyRows, error: null })),
              })),
            })),
          })),
        })),
      })),
    }

    const posts = [
      {
        id: 'm1',
        media_product_type: 'STORY' as const,
        media_type: 'IMAGE',
        insights: { reach: 1, views: 2 },
      },
      {
        id: 'm2',
        media_product_type: 'FEED' as const,
        media_type: 'IMAGE',
        insights: { reach: 999 },
      },
    ]

    await mergeLatestStoryInsightsIntoPostList(supabase as never, posts)

    expect(posts[0].insights?.reach).toBe(200)
    expect(posts[0].insights?.views).toBe(50)
    expect(posts[1].insights?.reach).toBe(999)
  })
})
