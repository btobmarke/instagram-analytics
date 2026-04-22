export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  groupInsightFactsByMedia,
  buildOverlayCumulativeHourlyRows,
  buildMilestoneDiffTable,
  INSIGHT_MILESTONES,
  INSIGHT_MILESTONES_STORY,
  type OverlaySeriesPost,
} from '@/lib/instagram/post-insight-chart'
import {
  OVERLAY_METRICS_FEED,
  OVERLAY_METRICS_STORY,
  isStoryMedia,
  overlayDiffMetricsForPost,
} from '@/lib/instagram/post-display-mode'
import { fetchMergedInsightFactRowsForOverlay } from '@/lib/instagram/post-insight-fact-query'
import type { IgMedia } from '@/types'

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

  const mainPost = byId.get(mainId)! as IgMedia
  const peerPosts = peerIds.map(pid => byId.get(pid)!) as IgMedia[]

  const mainStory = isStoryMedia(mainPost)
  if (!peerPosts.every(p => isStoryMedia(p) === mainStory)) {
    return NextResponse.json(
      { error: '比較は同じ種別（ストーリー同士、またはフィード／リール同士）のみ可能です' },
      { status: 400 }
    )
  }

  const allowedMetrics = mainStory ? OVERLAY_METRICS_STORY : OVERLAY_METRICS_FEED
  const metric = searchParams.get('metric') ?? (mainStory ? 'reach' : 'reach')
  if (!allowedMetrics.includes(metric as never)) {
    return NextResponse.json({ error: 'metric が不正です' }, { status: 400 })
  }

  const defaultMax = mainStory ? 24 : 72
  const maxHours = Math.min(mainStory ? 24 : 168, Math.max(6, Number(searchParams.get('maxHours') ?? defaultMax) || defaultMax))

  const metricsForDiff = overlayDiffMetricsForPost(mainPost).filter(m =>
    allowedMetrics.includes(m as never)
  )

  const postList = [mainPost, ...peerPosts]
  const codes = [...new Set([metric, ...metricsForDiff])]

  let grouped: Record<string, Record<string, Array<{ snapshot_at: string; value: number | null }>>>
  try {
    const mergedByMedia = await fetchMergedInsightFactRowsForOverlay(supabase, postList, codes)
    const flat: Array<{ media_id: string; metric_code: string; snapshot_at: string; value: number | null }> = []
    for (const [mid, rows] of Object.entries(mergedByMedia)) {
      for (const r of rows) {
        flat.push({ media_id: mid, metric_code: r.metric_code, snapshot_at: r.snapshot_at, value: r.value })
      }
    }
    grouped = groupInsightFactsByMedia(flat)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'インサイトの取得に失敗しました'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

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

  const milestones = mainStory ? INSIGHT_MILESTONES_STORY : INSIGHT_MILESTONES
  const mainSeries = overlayPosts[0]
  const diffTables = peerIds.map(pid => {
    const peer = overlayPosts.find(o => o.id === pid)!
    return {
      peerId: pid,
      peerLabel: peer.label,
      rows: buildMilestoneDiffTable(mainSeries, peer, metricsForDiff, milestones),
    }
  })

  return NextResponse.json({
    metric,
    maxHours,
    overlayRows,
    diffTables,
    posts: overlayPosts.map(p => ({ id: p.id, label: p.label, posted_at: p.postedAtIso })),
    is_story: mainStory,
  })
}
