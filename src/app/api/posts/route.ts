export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 表示回数と手入力のビュー内訳%からフォロワー／フォロワー外の件数を推定 */
function deriveFollowerViewCounts(
  views: number | null | undefined,
  followerPct: number | null,
  nonFollowerPct: number | null
): { follower: number | null; nonFollower: number | null } {
  if (views == null || !Number.isFinite(views) || views < 0) {
    return { follower: null, nonFollower: null }
  }
  const fp = followerPct != null && Number.isFinite(followerPct) ? followerPct : null
  const nfp = nonFollowerPct != null && Number.isFinite(nonFollowerPct) ? nonFollowerPct : null
  if (fp != null) {
    const follower = Math.round((views * fp) / 100)
    const nonFollower =
      nfp != null ? Math.round((views * nfp) / 100) : Math.max(0, views - follower)
    return { follower, nonFollower }
  }
  if (nfp != null) {
    const nonFollower = Math.round((views * nfp) / 100)
    const follower = Math.max(0, views - nonFollower)
    return { follower, nonFollower }
  }
  return { follower: null, nonFollower: null }
}

/** 手入力の views_from_home（最新）・ビューのフォロワー内訳%と件数、フォロワー数を付与 */
async function appendHomeRateFields(
  supabase: SupabaseClient,
  accountId: string,
  postsList: Array<Record<string, unknown> & { id: string; insights?: Record<string, number | null> }>
): Promise<{
  data: Array<
    Record<string, unknown> & {
      id: string
      manual_views_from_home: number | null
      manual_views_follower_pct: number | null
      manual_views_non_follower_pct: number | null
      views_follower_count: number | null
      views_non_follower_count: number | null
    }
  >
  followers_count: number | null
}> {
  const { data: acct } = await supabase.from('ig_accounts').select('followers_count').eq('id', accountId).maybeSingle()
  const followers_count =
    typeof acct?.followers_count === 'number' ? acct.followers_count : null

  const ids = postsList.map(p => p.id).filter(Boolean)
  const manualHomeMap = new Map<string, number>()
  /** 各投稿の recorded_at が最も新しい手入力行（内訳%はここから） */
  const latestManualByMedia = new Map<
    string,
    { views_follower_pct: number | null; views_non_follower_pct: number | null }
  >()

  if (ids.length) {
    const { data: manualRows } = await supabase
      .from('ig_media_manual_insight_extra')
      .select(
        'media_id, views_from_home, views_follower_pct, views_non_follower_pct, recorded_at'
      )
      .in('media_id', ids)
      .order('recorded_at', { ascending: false })

    for (const row of manualRows ?? []) {
      const mid = row.media_id as string
      if (!latestManualByMedia.has(mid)) {
        latestManualByMedia.set(mid, {
          views_follower_pct: numOrNull(row.views_follower_pct),
          views_non_follower_pct: numOrNull(row.views_non_follower_pct),
        })
      }
      const v = row.views_from_home
      if (typeof v === 'number' && !manualHomeMap.has(mid)) {
        manualHomeMap.set(mid, v)
      }
    }
  }

  const data = postsList.map(p => {
    const latest = latestManualByMedia.get(p.id)
    const fp = latest?.views_follower_pct ?? null
    const nfp = latest?.views_non_follower_pct ?? null
    const views = p.insights && typeof p.insights === 'object' ? (p.insights.views ?? null) : null
    const { follower, nonFollower } = deriveFollowerViewCounts(
      views != null ? views : null,
      fp,
      nfp
    )
    return {
      ...p,
      manual_views_from_home: manualHomeMap.get(p.id) ?? null,
      manual_views_follower_pct: fp,
      manual_views_non_follower_pct: nfp,
      views_follower_count: follower,
      views_non_follower_count: nonFollower,
    }
  }) as Array<
    Record<string, unknown> & {
      id: string
      manual_views_from_home: number | null
      manual_views_follower_pct: number | null
      manual_views_non_follower_pct: number | null
      views_follower_count: number | null
      views_non_follower_count: number | null
    }
  >

  return { data, followers_count }
}

// GET /api/posts?account=<id>&limit=20&offset=0&type=FEED|REELS|STORY
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  const limit = parseInt(searchParams.get('limit') ?? '20', 10)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)
  const mediaType = searchParams.get('type')

  if (!accountId) return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })

  // 投稿一覧 + インサイト（LEFT 相当: インサイト未収集の投稿も一覧に出す。!inner だとインサイト0件の投稿が全て落ちる）
  let query = supabase
    .from('ig_media')
    .select(`
      *,
      ig_media_insight_fact(metric_code, value, snapshot_at)
    `, { count: 'exact' })
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .order('posted_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (mediaType) {
    query = query.eq('media_product_type', mediaType)
  }

  const { data: posts, count, error } = await query

  if (error) {
    // フォールバック: インサイトなし
    const { data: plain, count: c2, error: e2 } = await supabase
      .from('ig_media')
      .select('*', { count: 'exact' })
      .eq('account_id', accountId)
      .eq('is_deleted', false)
      .order('posted_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
    const plainList = (plain ?? []) as Array<Record<string, unknown> & { id: string }>
    const { data, followers_count } = await appendHomeRateFields(supabase, accountId, plainList)
    return NextResponse.json({ data, count: c2, offset, limit, followers_count })
  }

  // 各投稿・各メトリクスごとに snapshot_at が最も新しい行だけ採用（常に最新値）
  const enriched = posts?.map((post) => {
    const insights = post.ig_media_insight_fact as Array<{ metric_code: string; value: number | null; snapshot_at: string }>
    const newestByMetric: Record<string, { value: number | null; snapshot_at: string }> = {}
    for (const ins of (insights ?? [])) {
      const prev = newestByMetric[ins.metric_code]
      if (!prev || ins.snapshot_at > prev.snapshot_at) {
        newestByMetric[ins.metric_code] = { value: ins.value, snapshot_at: ins.snapshot_at }
      }
    }
    const latest: Record<string, number | null> = {}
    for (const [code, row] of Object.entries(newestByMetric)) {
      latest[code] = row.value
    }
    const { ig_media_insight_fact: _, ...rest } = post
    return { ...rest, insights: latest }
  })

  const list = (enriched ?? []) as Array<Record<string, unknown> & { id: string }>
  const { data, followers_count } = await appendHomeRateFields(supabase, accountId, list)

  return NextResponse.json({ data, count, offset, limit, followers_count })
}
