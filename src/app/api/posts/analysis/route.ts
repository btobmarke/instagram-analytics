export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/posts/analysis
 * 複数投稿の比較データを取得する
 * Query: ids=uuid1,uuid2,uuid3  grain=hourly|12h|daily  account=accountId
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const idsParam = searchParams.get('ids') ?? ''
  const grain = (searchParams.get('grain') ?? 'hourly') as 'hourly' | '12h' | 'daily'

  const postIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (postIds.length === 0) {
    return NextResponse.json({ error: 'ids パラメータが必要です' }, { status: 400 })
  }
  if (postIds.length > 10) {
    return NextResponse.json({ error: '一度に比較できる投稿は10件までです' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  // 1. 投稿基本情報を取得
  const { data: posts, error: postsErr } = await admin
    .from('ig_media')
    .select('*')
    .in('id', postIds)

  if (postsErr) {
    return NextResponse.json({ error: postsErr.message }, { status: 500 })
  }

  // 2. 各投稿のスナップショットを取得
  const { data: snapshots, error: snapshotsErr } = await admin
    .from('ig_media_insight_fact')
    .select('media_id, metric_code, snapshot_at, value')
    .in('media_id', postIds)
    .order('snapshot_at', { ascending: true })

  if (snapshotsErr) {
    return NextResponse.json({ error: snapshotsErr.message }, { status: 500 })
  }

  // 3. スナップショットをグラフ用に整形
  // grain に応じて時刻をグルーピング
  const grainMs = grain === 'hourly' ? 3600000 : grain === '12h' ? 43200000 : 86400000

  const postResults = (posts ?? []).map(post => {
    const postSnapshots = (snapshots ?? []).filter(s => s.media_id === post.id)

    // metric_code ごとに時系列データを整理してグラフ用に変換
    const metricMap: Record<string, Record<number, number | null>> = {}
    for (const snap of postSnapshots) {
      const t = new Date(snap.snapshot_at).getTime()
      // grain に丸める
      const bucket = Math.floor(t / grainMs) * grainMs
      if (!metricMap[snap.metric_code]) metricMap[snap.metric_code] = {}
      // 同じバケット内の最新値を使う
      metricMap[snap.metric_code][bucket] = snap.value
    }

    // 全メトリクス共通のタイムスタンプ一覧を作成
    const allBuckets = Array.from(
      new Set(
        Object.values(metricMap).flatMap(m => Object.keys(m).map(Number))
      )
    ).sort((a, b) => a - b)

    // 投稿日時からの経過時間でフィルタ（grain に応じた上限）
    const postedAt = new Date(post.posted_at).getTime()
    const maxDuration = grain === 'hourly' ? 72 * 3600000 : grain === '12h' ? 30 * 86400000 : 90 * 86400000
    const filteredBuckets = allBuckets.filter(b => b - postedAt <= maxDuration)

    // チャート用データポイント
    const chartData = filteredBuckets.map(bucket => {
      const point: Record<string, string | number | null> = {
        time: new Date(bucket).toISOString(),
        elapsed_hours: Math.round((bucket - postedAt) / 3600000),
      }
      for (const metric of Object.keys(metricMap)) {
        point[metric] = metricMap[metric][bucket] ?? null
      }
      return point
    })

    // 最新の指標値サマリー
    const latestInsights: Record<string, number | null> = {}
    for (const metric of Object.keys(metricMap)) {
      const values = Object.entries(metricMap[metric])
        .sort(([a], [b]) => Number(b) - Number(a))
      latestInsights[metric] = values[0]?.[1] ?? null
    }

    return {
      post,
      chartData,
      latestInsights,
      availableMetrics: Object.keys(metricMap),
    }
  })

  // 投稿順序を元のids順に並び替え
  const orderedResults = postIds
    .map(id => postResults.find(r => r.post.id === id))
    .filter(Boolean)

  return NextResponse.json({
    posts: orderedResults,
    grain,
    total: orderedResults.length,
  })
}
