export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const WINDOW_DAYS = new Set([1, 7, 30])

function normalizeUsername(s: string): string {
  return String(s).replace(/^@+/, '').trim().toLowerCase()
}

/** GET /api/instagram/like-users?account=<uuid>&days=1|7|30
 * 過去1年のうち、投稿日が直近 days 日以内の投稿について、手入力 liked_usernames（最新行）からユーザー別いいね回数を集計。
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  const daysRaw = parseInt(searchParams.get('days') ?? '7', 10)
  const days = WINDOW_DAYS.has(daysRaw as 1 | 7 | 30) ? daysRaw : 7

  if (!accountId) return NextResponse.json({ error: 'account が必要です' }, { status: 400 })

  const now = Date.now()
  const sinceYear = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString()
  const sinceWindow = new Date(now - days * 24 * 60 * 60 * 1000).toISOString()

  const { data: mediaRows, error: mErr } = await supabase
    .from('ig_media')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .gte('posted_at', sinceYear)
    .gte('posted_at', sinceWindow)

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  const mediaIds = (mediaRows ?? []).map((r) => r.id as string)
  const posts_in_window = mediaIds.length

  if (mediaIds.length === 0) {
    const { count: fc } = await supabase
      .from('ig_account_follower_usernames')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
    return NextResponse.json({
      data: [],
      meta: {
        window_days: days,
        posts_in_window: 0,
        posts_with_likers: 0,
        followers_list_count: fc ?? 0,
      },
    })
  }

  const latestByMedia = new Map<string, string[]>()
  const idChunk = 400
  for (let off = 0; off < mediaIds.length; off += idChunk) {
    const slice = mediaIds.slice(off, off + idChunk)
    const { data: manualRows, error: manErr } = await supabase
      .from('ig_media_manual_insight_extra')
      .select('media_id, liked_usernames, recorded_at')
      .in('media_id', slice)
      .order('recorded_at', { ascending: false })

    if (manErr) return NextResponse.json({ error: manErr.message }, { status: 500 })

    for (const row of manualRows ?? []) {
      const mid = row.media_id as string
      if (latestByMedia.has(mid)) continue
      const arr = row.liked_usernames as string[] | null
      if (!arr?.length) continue
      latestByMedia.set(mid, arr.map((u) => normalizeUsername(u)).filter(Boolean))
    }
  }

  const posts_with_likers = latestByMedia.size
  const counts = new Map<string, number>()
  for (const names of latestByMedia.values()) {
    const uniqInPost = new Set(names)
    for (const u of uniqInPost) {
      counts.set(u, (counts.get(u) ?? 0) + 1)
    }
  }

  const { count: followers_list_count } = await supabase
    .from('ig_account_follower_usernames')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)

  const followerSet = new Set<string>()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data: page, error: pErr } = await supabase
      .from('ig_account_follower_usernames')
      .select('username')
      .eq('account_id', accountId)
      .range(from, from + pageSize - 1)
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!page?.length) break
    for (const r of page) followerSet.add(String(r.username).toLowerCase())
    if (page.length < pageSize) break
  }

  const data = [...counts.entries()]
    .map(([username, like_count]) => ({
      username,
      like_count,
      is_follower: followerSet.has(username),
    }))
    .sort((a, b) => b.like_count - a.like_count || a.username.localeCompare(b.username))

  return NextResponse.json({
    data,
    meta: {
      window_days: days,
      posts_in_window,
      posts_with_likers,
      followers_list_count: followers_list_count ?? 0,
    },
  })
}
