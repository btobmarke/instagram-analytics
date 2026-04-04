export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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

  // 時系列インサイト（最新50スナップショット）
  const { data: insights } = await supabase
    .from('ig_media_insight_fact')
    .select('metric_code, value, snapshot_at')
    .eq('media_id', id)
    .order('snapshot_at', { ascending: false })
    .limit(200)

  // 最新インサイト（metric_codeごとに最新1件）
  const latestInsights: Record<string, number | null> = {}
  for (const row of (insights ?? [])) {
    if (!(row.metric_code in latestInsights)) {
      latestInsights[row.metric_code] = row.value
    }
  }

  // 時系列データ（グラフ用）
  const timeSeriesMap: Record<string, Array<{ snapshot_at: string; value: number | null }>> = {}
  for (const row of (insights ?? [])) {
    if (!timeSeriesMap[row.metric_code]) {
      timeSeriesMap[row.metric_code] = []
    }
    timeSeriesMap[row.metric_code].push({ snapshot_at: row.snapshot_at, value: row.value })
  }

  // 最新AI分析
  const { data: aiResults } = await supabase
    .from('ai_analysis_results')
    .select('*')
    .eq('account_id', post.account_id)
    .eq('analysis_type', 'post_analysis')
    .contains('media_ids', [id])
    .order('created_at', { ascending: false })
    .limit(1)

  return NextResponse.json({
    data: {
      post,
      latest_insights: latestInsights,
      time_series: timeSeriesMap,
      latest_ai_analysis: aiResults?.[0] ?? null,
    }
  })
}
