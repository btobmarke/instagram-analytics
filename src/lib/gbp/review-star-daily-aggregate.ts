/**
 * gbp_reviews 行から、投稿日（JST）× 星別の日次件数を集計する。
 */

export type StarBucketKey = 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE' | 'NONE'

/** RFC3339 の create_time → Asia/Tokyo の暦日 YYYY-MM-DD */
export function reviewDateKeyJst(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export function starRatingToBucket(raw: string | null | undefined): StarBucketKey {
  if (raw == null || String(raw).trim() === '') return 'NONE'
  const s = String(raw).trim()
  if (s === 'STAR_RATING_UNSPECIFIED') return 'NONE'
  if (s === 'ONE') return 'ONE'
  if (s === 'TWO') return 'TWO'
  if (s === 'THREE') return 'THREE'
  if (s === 'FOUR') return 'FOUR'
  if (s === 'FIVE') return 'FIVE'
  // 想定外は星なし扱い（将来の enum 追加時も落ちないように）
  return 'NONE'
}

export type DailyStarCounts = {
  stars_1: number
  stars_2: number
  stars_3: number
  stars_4: number
  stars_5: number
  stars_none: number
}

const emptyCounts = (): DailyStarCounts => ({
  stars_1: 0,
  stars_2: 0,
  stars_3: 0,
  stars_4: 0,
  stars_5: 0,
  stars_none: 0,
})

function bump(c: DailyStarCounts, b: StarBucketKey) {
  switch (b) {
    case 'ONE': c.stars_1++; break
    case 'TWO': c.stars_2++; break
    case 'THREE': c.stars_3++; break
    case 'FOUR': c.stars_4++; break
    case 'FIVE': c.stars_5++; break
    default: c.stars_none++; break
  }
}

/** レビュー配列から date (JST) → 件数マップ */
export function aggregateReviewsToDailyStarCounts(
  rows: Array<{ create_time: string; star_rating: string | null }>,
): Map<string, DailyStarCounts> {
  const byDate = new Map<string, DailyStarCounts>()
  for (const r of rows) {
    const dk = reviewDateKeyJst(r.create_time)
    if (!dk) continue
    const b = starRatingToBucket(r.star_rating)
    let c = byDate.get(dk)
    if (!c) {
      c = emptyCounts()
      byDate.set(dk, c)
    }
    bump(c, b)
  }
  return byDate
}
