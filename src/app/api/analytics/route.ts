export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/analytics?account=<id>&grain=daily&metric=reach&since=2024-01-01&until=2024-01-31
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  const grain = searchParams.get('grain') ?? 'daily'
  const metricCodes = searchParams.get('metrics')?.split(',') ?? ['reach', 'views', 'profile_views']
  const since = searchParams.get('since') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const until = searchParams.get('until') ?? new Date().toISOString().slice(0, 10)

  if (!accountId) return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })

  // KPI結果取得
  const { data: kpiResults } = await supabase
    .from('kpi_result')
    .select(`
      *,
      kpi_master(kpi_code, kpi_name, unit_type)
    `)
    .eq('account_id', accountId)
    .eq('grain', grain)
    .eq('subject_type', 'account')
    .gte('period_start', since)
    .lte('period_end', until)
    .order('period_start', { ascending: true })

  // アカウントインサイト取得（時系列グラフ用）
  const { data: accountInsights } = await supabase
    .from('ig_account_insight_fact')
    .select('metric_code, value_date, value')
    .eq('account_id', accountId)
    .in('metric_code', metricCodes)
    .gte('value_date', since)
    .lte('value_date', until)
    .order('value_date', { ascending: true })

  // フォロワー推移
  const { data: followerData } = await supabase
    .from('ig_account_insight_fact')
    .select('value_date, value')
    .eq('account_id', accountId)
    .eq('metric_code', 'follower_count')
    .gte('value_date', since)
    .lte('value_date', until)
    .order('value_date', { ascending: true })

  // KPI進捗取得
  const { data: kpiProgress } = await supabase
    .from('kpi_progress')
    .select(`
      *,
      kpi_result(kpi_id, period_start, period_end, kpi_master(kpi_code, kpi_name))
    `)
    .eq('account_id', accountId)
    .order('evaluated_at', { ascending: false })
    .limit(20)

  // 投稿サマリー（期間内）
  const { data: posts } = await supabase
    .from('ig_media')
    .select('id, media_product_type, posted_at')
    .eq('account_id', accountId)
    .gte('posted_at', since)
    .lte('posted_at', until)
    .eq('is_deleted', false)

  const postSummary = {
    total: posts?.length ?? 0,
    feed: posts?.filter(p => p.media_product_type === 'FEED').length ?? 0,
    reels: posts?.filter(p => p.media_product_type === 'REELS').length ?? 0,
    story: posts?.filter(p => p.media_product_type === 'STORY').length ?? 0,
  }

  return NextResponse.json({
    data: {
      account_insights: accountInsights,
      follower_data: followerData,
      kpi_results: kpiResults,
      kpi_progress: kpiProgress,
      post_summary: postSummary,
    }
  })
}
