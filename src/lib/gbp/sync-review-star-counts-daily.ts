import type { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { aggregateReviewsToDailyStarCounts } from '@/lib/gbp/review-star-daily-aggregate'

type Admin = ReturnType<typeof createSupabaseAdminClient>

/**
 * gbp_reviews 全件から星別日次集計を作り直し、gbp_review_star_counts_daily を置き換える。
 */
export async function syncGbpReviewStarCountsDaily(admin: Admin, siteId: string): Promise<void> {
  const { data: rows, error } = await admin
    .from('gbp_reviews')
    .select('create_time, star_rating')
    .eq('gbp_site_id', siteId)

  if (error) {
    throw new Error(`gbp_reviews select for star counts: ${error.message}`)
  }

  const map = aggregateReviewsToDailyStarCounts(
    (rows ?? []) as Array<{ create_time: string; star_rating: string | null }>,
  )

  const { error: delErr } = await admin.from('gbp_review_star_counts_daily').delete().eq('gbp_site_id', siteId)
  if (delErr) {
    throw new Error(`gbp_review_star_counts_daily delete: ${delErr.message}`)
  }

  const upsertRows = [...map.entries()].map(([date, c]) => ({
    gbp_site_id: siteId,
    date,
    stars_1: c.stars_1,
    stars_2: c.stars_2,
    stars_3: c.stars_3,
    stars_4: c.stars_4,
    stars_5: c.stars_5,
    stars_none: c.stars_none,
    updated_at: new Date().toISOString(),
  }))

  const CHUNK = 300
  for (let i = 0; i < upsertRows.length; i += CHUNK) {
    const slice = upsertRows.slice(i, i + CHUNK)
    const { error: insErr } = await admin.from('gbp_review_star_counts_daily').insert(slice)
    if (insErr) {
      throw new Error(`gbp_review_star_counts_daily insert: ${insErr.message}`)
    }
  }
}
