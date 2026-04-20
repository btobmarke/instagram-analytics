export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildTimeSeriesMapFromFactRows } from '@/lib/instagram/post-insight-chart'
import { IG_MEDIA_INSIGHT_FACT_MAX_ROWS } from '@/lib/instagram/post-insight-fact-query'
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

  // 時系列インサイト（公開からの推移用に昇順・十分な件数）
  const { data: insights } = await supabase
    .from('ig_media_insight_fact')
    .select('metric_code, value, snapshot_at')
    .eq('media_id', id)
    .order('snapshot_at', { ascending: true })
    .limit(IG_MEDIA_INSIGHT_FACT_MAX_ROWS)

  // 最新インサイト（metric_code ごとに時刻が最も新しい値）
  const latestInsights: Record<string, number | null> = {}
  for (const row of insights ?? []) {
    latestInsights[row.metric_code] = row.value
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
