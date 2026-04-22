export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildTimeSeriesMapFromFactRows } from '@/lib/instagram/post-insight-chart'
import { fetchMergedInsightFactRowsForPostDetail } from '@/lib/instagram/post-insight-fact-query'
import type { IgMediaManualInsightExtra } from '@/types'

// GET /api/posts/[id] — 投稿詳細 + 時系列インサイト + 最新AI分析
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 投稿本体
  const { data: post, error: postError } = await supabase
    .from('ig_media')
    .select('*')
    .eq('id', id)
    .single()
  if (postError) return NextResponse.json({ error: postError.message }, { status: 404 })

  // 時系列インサイト（range ページング: PostgREST の max_rows で単一 limit が打ち切られるのを避ける）
  let insights: Awaited<ReturnType<typeof fetchMergedInsightFactRowsForPostDetail>> = []
  try {
    insights = await fetchMergedInsightFactRowsForPostDetail(supabase, post)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ig_media_insight_fact の取得に失敗しました'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // 最新インサイト（metric_code ごとに snapshot_at が最も新しい値）
  const newestByMetric: Record<string, { value: number | null; snapshot_at: string }> = {}
  for (const row of insights ?? []) {
    const prev = newestByMetric[row.metric_code]
    if (!prev || row.snapshot_at > prev.snapshot_at) {
      newestByMetric[row.metric_code] = { value: row.value, snapshot_at: row.snapshot_at }
    }
  }
  const latestInsights: Record<string, number | null> = {}
  for (const [code, row] of Object.entries(newestByMetric)) {
    latestInsights[code] = row.value
  }

  const timeSeriesMap = buildTimeSeriesMapFromFactRows(insights ?? [])

  // 最新AI分析
  const { data: aiResults } = await supabase
    .from('ai_analysis_results')
    .select('*')
    .eq('account_id', post.account_id)
    .eq('analysis_type', 'post_analysis')
    .contains('media_ids', [id])
    .order('created_at', { ascending: false })
    .limit(1)

  const { data: manualInsightExtra } = await supabase
    .from('ig_media_manual_insight_extra')
    .select('*')
    .eq('media_id', id)
    .order('recorded_at', { ascending: false })

  return NextResponse.json({
    data: {
      post,
      latest_insights: latestInsights,
      time_series: timeSeriesMap,
      latest_ai_analysis: aiResults?.[0] ?? null,
      manual_insight_extra: (manualInsightExtra ?? []) as IgMediaManualInsightExtra[],
    }
  })
}
