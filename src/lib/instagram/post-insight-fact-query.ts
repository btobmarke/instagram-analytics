import type { SupabaseClient } from '@supabase/supabase-js'

export type IgMediaInsightFactRow = {
  metric_code: string
  value: number | null
  snapshot_at: string
}

/**
 * 投稿1件あたりの取得上限（無限ループ防止）。
 * 通常は毎時スナップ × 数十メトリクスでも数万行未満想定。
 */
export const IG_MEDIA_INSIGHT_FACT_MAX_ROWS = 500_000

/**
 * PostgREST / Supabase の API はプロジェクトの max_rows（既定 1000 など）で
 * レスポンスが打ち切られる。大きな limit だけでは足りないため range でページングする。
 */
const PAGE_SIZE = 1000

/**
 * 1 メディアの ig_media_insight_fact を snapshot_at 昇順で全件取得（上限まで）。
 */
export async function fetchAllIgMediaInsightFactRows(
  supabase: SupabaseClient,
  mediaId: string
): Promise<IgMediaInsightFactRow[]> {
  const out: IgMediaInsightFactRow[] = []
  let from = 0

  while (out.length < IG_MEDIA_INSIGHT_FACT_MAX_ROWS) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('ig_media_insight_fact')
      .select('metric_code, value, snapshot_at')
      .eq('media_id', mediaId)
      .order('snapshot_at', { ascending: true })
      .range(from, to)

    if (error) throw error
    const chunk = (data ?? []) as IgMediaInsightFactRow[]
    if (chunk.length === 0) break
    out.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return out
}
