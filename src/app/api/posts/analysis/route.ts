export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { analyzePostComparison } from '@/lib/claude/client'
import { getAiModelIdForAccountId } from '@/lib/ai/resolve-ai-model'
import type { IgMedia } from '@/types'

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

/**
 * POST /api/posts/analysis
 * 比較対象の複数投稿を題材に AI 比較解説をストリーミング返却する
 * Body: { ids: string[] }（2〜10件・同一アカウント）
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { ids?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : []
  const postIds = rawIds.map((id) => String(id).trim()).filter(Boolean)
  if (postIds.length < 2) {
    return NextResponse.json({ error: '比較には2件以上の投稿IDが必要です' }, { status: 400 })
  }
  if (postIds.length > 10) {
    return NextResponse.json({ error: '一度に比較できる投稿は10件までです' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  const { data: posts, error: postsErr } = await admin
    .from('ig_media')
    .select('*')
    .in('id', postIds)

  if (postsErr) {
    return NextResponse.json({ error: postsErr.message }, { status: 500 })
  }
  if (!posts || posts.length !== postIds.length) {
    return NextResponse.json({ error: '一部の投稿が見つかりません' }, { status: 404 })
  }

  const typedPosts = posts as IgMedia[]
  const accountIds = new Set(typedPosts.map((p) => p.account_id))
  if (accountIds.size !== 1) {
    return NextResponse.json({ error: '同一アカウントの投稿のみ比較できます' }, { status: 400 })
  }
  const accountId = typedPosts[0].account_id

  const { data: insightRows, error: insightErr } = await admin
    .from('ig_media_insight_fact')
    .select('media_id, metric_code, value, snapshot_at')
    .in('media_id', postIds)
    .order('snapshot_at', { ascending: false })

  if (insightErr) {
    return NextResponse.json({ error: insightErr.message }, { status: 500 })
  }

  const insightsByMedia: Record<string, Record<string, number | null>> = {}
  for (const id of postIds) insightsByMedia[id] = {}
  for (const row of insightRows ?? []) {
    const mid = row.media_id as string
    const bucket = insightsByMedia[mid]
    if (bucket && !(row.metric_code in bucket)) {
      bucket[row.metric_code] = row.value
    }
  }

  const orderedPosts = postIds
    .map((id) => typedPosts.find((p) => p.id === id))
    .filter((p): p is IgMedia => Boolean(p))

  const postsForAi = orderedPosts.map((post) => ({
    post,
    insights: insightsByMedia[post.id] ?? {},
  }))

  const { data: account } = await supabase
    .from('ig_accounts')
    .select('username')
    .eq('id', accountId)
    .single()

  const { data: promptSetting } = await supabase
    .from('analysis_prompt_settings')
    .select('prompt_text')
    .eq('prompt_type', 'post_comparison')
    .eq('is_active', true)
    .single()

  const { data: strategySetting } = await supabase
    .from('account_strategy_settings')
    .select('strategy_text')
    .eq('account_id', accountId)
    .single()

  const promptText =
    promptSetting?.prompt_text ??
    '複数投稿の指標と内容を比較し、差分の要因と次回投稿への示唆を述べてください。'
  const accountStrategy = strategySetting?.strategy_text ?? ''
  const accountUsername = account?.username ?? 'unknown'
  const modelId = await getAiModelIdForAccountId(supabase, accountId)

  const stream = await analyzePostComparison({
    posts: postsForAi,
    promptText,
    accountStrategy,
    accountUsername,
    modelId,
  })

  let fullText = ''
  const [stream1, stream2] = stream.tee()
  ;(async () => {
    const reader = stream2.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
    }
    await admin.from('ai_analysis_results').insert({
      account_id: accountId,
      analysis_type: 'post_comparison',
      media_ids: postIds,
      analysis_result: fullText,
      model_used: modelId,
      triggered_by: 'user',
    })
  })()

  return new Response(stream1, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
