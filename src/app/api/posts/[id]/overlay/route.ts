export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  groupInsightFactsByMedia,
  buildOverlayCumulativeHourlyRows,
  buildMilestoneDiffTable,
  type OverlaySeriesPost,
} from '@/lib/instagram/post-insight-chart'

const OVERLAY_METRICS = ['reach', 'likes', 'saved', 'comments', 'impressions', 'views'] as const

function shortLabel(post: { id: string; posted_at: string; caption: string | null }): string {
  const d = new Date(post.posted_at)
  const dateStr = `${d.getMonth() + 1}/${d.getDate()}`
  const cap = (post.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 18)
  return cap ? `${dateStr} · ${cap}${cap.length >= 18 ? '…' : ''}` : dateStr
}

// GET /api/posts/[id]/overlay?peerIds=uuid,uuid&metric=reach&maxHours=72
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: mainId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const peerIds = (searchParams.get('peerIds') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 2)

  if (peerIds.length === 0) {
    return NextResponse.json({ error: 'peerIds が必要です（最大2件）' }, { status: 400 })
  }

  const metric = searchParams.get('metric') ?? 'reach'
  if (!OVERLAY_METRICS.includes(metric as (typeof OVERLAY_METRICS)[number])) {
    return NextResponse.json({ error: 'metric が不正です' }, { status: 400 })
  }

  const maxHours = Math.min(168, Math.max(6, Number(searchParams.get('maxHours') ?? 72) || 72))

  const allIds = [mainId, ...peerIds]
  const { data: posts, error: postsErr } = await supabase
    .from('ig_media')
    .select('id, account_id, posted_at, caption, media_product_type, media_type')
    .in('id', allIds)

  if (postsErr || !posts?.length) {
    return NextResponse.json({ error: '投稿の取得に失敗しました' }, { status: 500 })
  }

  const byId = new Map(posts.map(p => [p.id, p]))
  if (!byId.has(mainId)) {
    return NextResponse.json({ error: 'メイン投稿が見つかりません' }, { status: 404 })
  }
  for (const pid of peerIds) {
    if (!byId.has(pid)) {
      return NextResponse.json({ error: `ピア投稿が見つかりません: ${pid}` }, { status: 404 })
    }
  }

  const accountId = posts[0].account_id
  if (!posts.every(p => p.account_id === accountId)) {
    return NextResponse.json({ error: '同一アカウントの投稿のみ比較できます' }, { status: 400 })
  }

  const metricsForDiff = ['reach', 'likes', 'saved'].filter(m =>
    ['reach', 'likes', 'saved', 'comments', 'impressions', 'views'].includes(m)
  )

  const { data: facts, error: factErr } = await supabase
    .from('ig_media_insight_fact')
    .select('media_id, metric_code, snapshot_at, value')
    .in('media_id', allIds)
    .in('metric_code', [...new Set([metric, ...metricsForDiff])])
    .order('snapshot_at', { ascending: true })
    .limit(12000)

  if (factErr) {
    return NextResponse.json({ error: factErr.message }, { status: 500 })
  }

  const grouped = groupInsightFactsByMedia(facts ?? [])

  const mainPost = byId.get(mainId)!
  const overlayPosts: OverlaySeriesPost[] = [
    {
      id: mainId,
      label: 'この投稿',
      postedAtIso: mainPost.posted_at,
      timeSeries: grouped[mainId] ?? {},
    },
    ...peerIds.map(pid => {
      const p = byId.get(pid)!
      return {
        id: pid,
        label: shortLabel(p),
        postedAtIso: p.posted_at,
        timeSeries: grouped[pid] ?? {},
      }
    }),
  ]

  const overlayRows = buildOverlayCumulativeHourlyRows(overlayPosts, metric, maxHours)

  const mainSeries = overlayPosts[0]
  const diffTables = peerIds.map(pid => {
    const peer = overlayPosts.find(o => o.id === pid)!
    return {
      peerId: pid,
      peerLabel: peer.label,
      rows: buildMilestoneDiffTable(mainSeries, peer, metricsForDiff),
    }
  })

  return NextResponse.json({
    metric,
    maxHours,
    overlayRows,
    diffTables,
    posts: overlayPosts.map(p => ({ id: p.id, label: p.label, posted_at: p.postedAtIso })),
  })
}
