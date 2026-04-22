import type { SupabaseClient } from '@supabase/supabase-js'
import { isStoryMedia } from '@/lib/instagram/post-display-mode'
import type { IgMedia } from '@/types'

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

export type IgStoryInsightFactRow = {
  metric_code: string
  value: number | null
  fetched_at: string
}

/**
 * ストーリー専用バッチの `ig_story_insight_fact` を snapshot_at 昇順で全件取得。
 */
export async function fetchAllIgStoryInsightFactRows(
  supabase: SupabaseClient,
  mediaId: string
): Promise<IgStoryInsightFactRow[]> {
  const out: IgStoryInsightFactRow[] = []
  let from = 0

  while (out.length < IG_MEDIA_INSIGHT_FACT_MAX_ROWS) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('ig_story_insight_fact')
      .select('metric_code, value, fetched_at')
      .eq('media_id', mediaId)
      .order('fetched_at', { ascending: true })
      .range(from, to)

    if (error) throw error
    const chunk = (data ?? []) as IgStoryInsightFactRow[]
    if (chunk.length === 0) break
    out.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return out
}

export function storyRowToMediaShape(r: IgStoryInsightFactRow): IgMediaInsightFactRow {
  const v = r.value
  return {
    metric_code: r.metric_code,
    value: typeof v === 'number' && Number.isFinite(v) ? v : v == null ? null : Number(v),
    snapshot_at: r.fetched_at,
  }
}

function mergeFactRows(mediaRows: IgMediaInsightFactRow[], storyAdapted: IgMediaInsightFactRow[]): IgMediaInsightFactRow[] {
  const byKey = new Map<string, IgMediaInsightFactRow>()
  for (const r of mediaRows) {
    byKey.set(`${r.metric_code}\0${r.snapshot_at}`, r)
  }
  for (const r of storyAdapted) {
    byKey.set(`${r.metric_code}\0${r.snapshot_at}`, r)
  }
  return Array.from(byKey.values()).sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at))
}

/**
 * 投稿詳細用: ストーリーは `ig_story_insight_fact` を `ig_media_insight_fact` 形に合わせてマージ。
 * 同一 (metric_code, snapshot_at) はストーリー側の行を優先（時刻丸めの hourly バッチを正とする）。
 */
export async function fetchMergedInsightFactRowsForPostDetail(
  supabase: SupabaseClient,
  post: Pick<IgMedia, 'id' | 'media_product_type' | 'media_type'>
): Promise<IgMediaInsightFactRow[]> {
  const mediaRows = await fetchAllIgMediaInsightFactRows(supabase, post.id)
  if (!isStoryMedia(post)) return mediaRows

  let storyRows: IgStoryInsightFactRow[] = []
  try {
    storyRows = await fetchAllIgStoryInsightFactRows(supabase, post.id)
  } catch {
    return mediaRows
  }

  return mergeFactRows(
    mediaRows,
    storyRows.map(storyRowToMediaShape)
  )
}

/**
 * オーバーレイ用: 複数メディアのインサイト行を取得し、ストーリーは `ig_story_insight_fact` をマージ。
 */
export async function fetchMergedInsightFactRowsForOverlay(
  supabase: SupabaseClient,
  posts: Array<Pick<IgMedia, 'id' | 'media_product_type' | 'media_type'>>,
  metricCodes: string[]
): Promise<Record<string, IgMediaInsightFactRow[]>> {
  const ids = posts.map(p => p.id)
  const codes = [...new Set(metricCodes)]
  if (ids.length === 0 || codes.length === 0) return {}

  const { data: mediaFacts, error: mfErr } = await supabase
    .from('ig_media_insight_fact')
    .select('media_id, metric_code, snapshot_at, value')
    .in('media_id', ids)
    .in('metric_code', codes)
    .order('snapshot_at', { ascending: true })
    .limit(12000)

  if (mfErr) throw mfErr

  const byMedia: Record<string, IgMediaInsightFactRow[]> = {}
  for (const id of ids) byMedia[id] = []
  for (const row of mediaFacts ?? []) {
    const mid = row.media_id as string
    if (!byMedia[mid]) byMedia[mid] = []
    byMedia[mid].push({
      metric_code: row.metric_code as string,
      value: row.value as number | null,
      snapshot_at: row.snapshot_at as string,
    })
  }

  const storyIds = posts.filter(p => isStoryMedia(p)).map(p => p.id)
  if (storyIds.length === 0) return byMedia

  const { data: storyFacts, error: sfErr } = await supabase
    .from('ig_story_insight_fact')
    .select('media_id, metric_code, value, fetched_at')
    .in('media_id', storyIds)
    .in('metric_code', codes)
    .order('fetched_at', { ascending: true })
    .limit(12000)

  if (sfErr) return byMedia

  const storyByMedia = new Map<string, IgStoryInsightFactRow[]>()
  for (const row of storyFacts ?? []) {
    const mid = row.media_id as string
    if (!storyByMedia.has(mid)) storyByMedia.set(mid, [])
    storyByMedia.get(mid)!.push({
      metric_code: row.metric_code as string,
      value: row.value as number | null,
      fetched_at: row.fetched_at as string,
    })
  }

  for (const sid of storyIds) {
    const mediaRows = byMedia[sid] ?? []
    const sRows = storyByMedia.get(sid) ?? []
    byMedia[sid] = mergeFactRows(mediaRows, sRows.map(storyRowToMediaShape))
  }

  return byMedia
}
