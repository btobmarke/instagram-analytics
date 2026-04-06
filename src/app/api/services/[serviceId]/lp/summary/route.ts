import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const VALID_RANGES = ['all', '30d', '7d', 'today'] as const
type RangeType = typeof VALID_RANGES[number]

function getRangeStart(range: RangeType): string | null {
  const now = new Date()
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    case 'all':
      return null
  }
}

/**
 * GET /api/services/:serviceId/lp/summary
 * LP サマリー取得 API
 *
 * metric_summaries テーブルからの集計値を返す。
 * データがない場合は lp_sessions / lp_users から直接集計してフォールバック。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 }
    )
  }

  // サービス確認（LP種別のみ）
  const { data: service } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .single()

  if (!service || service.service_type !== 'lp') {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'LPサービスが見つかりません' } },
      { status: 404 }
    )
  }

  // LP Site 取得
  const { data: lpSite } = await supabase
    .from('lp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()

  if (!lpSite) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'LP設定が見つかりません' } },
      { status: 404 }
    )
  }

  const { searchParams } = new URL(request.url)
  const rangeParam = searchParams.get('range') ?? '30d'
  if (!VALID_RANGES.includes(rangeParam as RangeType)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_RANGE', message: 'rangeの値が不正です' } },
      { status: 400 }
    )
  }
  const range = rangeParam as RangeType
  const rangeStart = getRangeStart(range)

  // metric_summaries から最新の集計値を取得
  let summaryQuery = supabase
    .from('metric_summaries')
    .select('metric_name, value, source_type, summary_date')
    .eq('service_id', serviceId)
    .eq('range_type', range)
    .order('summary_date', { ascending: false })

  const { data: summaryRows } = await summaryQuery
  const metricsFromSummary = summaryRows ?? []

  // 既存の集計があれば返す
  if (metricsFromSummary.length > 0) {
    // 最新日付のもののみ抽出
    const latestDate = metricsFromSummary[0].summary_date
    const latestMetrics = metricsFromSummary.filter(r => r.summary_date === latestDate)

    return NextResponse.json({
      success: true,
      data: {
        range,
        metrics: latestMetrics.map(m => ({
          metricName: m.metric_name,
          value: m.value,
          sourceType: m.source_type,
        })),
        rankings: { event: [], page: [], exit: [], referrer: [], stayBucket: [] },
        fetchedAt: new Date().toISOString(),
        dataSource: 'summary',
      },
    })
  }

  // フォールバック: lp_sessions / lp_users から直接集計
  let sessionQuery = supabase
    .from('lp_sessions')
    .select('id, lp_user_id, duration_seconds, session_intent_score, referrer_source, started_at')
    .eq('lp_site_id', lpSite.id)

  if (rangeStart) {
    sessionQuery = sessionQuery.gte('started_at', rangeStart)
  }

  const { data: sessions } = await sessionQuery
  const allSessions = sessions ?? []

  const sessionCount = allSessions.length
  const uniqueUserIds = new Set(allSessions.map(s => s.lp_user_id))
  const userCount = uniqueUserIds.size

  const durationsWithValue = allSessions.filter(s => s.duration_seconds > 0)
  const avgStaySeconds =
    durationsWithValue.length > 0
      ? durationsWithValue.reduce((sum, s) => sum + s.duration_seconds, 0) / durationsWithValue.length
      : 0

  // ランキング: イベント
  const { data: eventRankRaw } = await supabase
    .from('lp_event_logs')
    .select('raw_event_id, event_name_snapshot')
    .eq('lp_site_id', lpSite.id)
    .gte('occurred_at', rangeStart ?? '1970-01-01')

  const eventCounts: Record<string, { label: string; count: number }> = {}
  for (const log of eventRankRaw ?? []) {
    const key = log.raw_event_id
    if (!eventCounts[key]) {
      eventCounts[key] = { label: log.event_name_snapshot ?? key, count: 0 }
    }
    eventCounts[key].count++
  }
  const eventRanking = Object.entries(eventCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([key, val], i) => ({ rank_no: i + 1, item_key: key, item_label: val.label, count_value: val.count, source_type: 'MA' }))

  // ランキング: ページ
  const { data: pageViewRaw } = await supabase
    .from('lp_page_views')
    .select('page_url, page_title')
    .eq('lp_site_id', lpSite.id)
    .gte('occurred_at', rangeStart ?? '1970-01-01')

  const pageCounts: Record<string, { label: string; count: number }> = {}
  for (const pv of pageViewRaw ?? []) {
    const key = pv.page_url ?? ''
    if (!pageCounts[key]) pageCounts[key] = { label: pv.page_title ?? key, count: 0 }
    pageCounts[key].count++
  }
  const pageRanking = Object.entries(pageCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([key, val], i) => ({ rank_no: i + 1, item_key: key, item_label: val.label, count_value: val.count, source_type: 'MA' }))

  // 流入元ランキング
  const referrerCounts: Record<string, number> = {}
  for (const s of allSessions) {
    const key = s.referrer_source ?? 'direct'
    referrerCounts[key] = (referrerCounts[key] ?? 0) + 1
  }
  const referrerRanking = Object.entries(referrerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count], i) => ({ rank_no: i + 1, item_key: key, item_label: key, count_value: count, source_type: 'MA' }))

  return NextResponse.json({
    success: true,
    data: {
      range,
      metrics: [
        { metricName: 'session_count', value: sessionCount, sourceType: 'MA' },
        { metricName: 'user_count', value: userCount, sourceType: 'MA' },
        { metricName: 'avg_stay_seconds', value: Math.round(avgStaySeconds * 10) / 10, sourceType: 'MA' },
      ],
      rankings: {
        event: eventRanking,
        page: pageRanking,
        exit: [],
        referrer: referrerRanking,
        stayBucket: [],
      },
      fetchedAt: new Date().toISOString(),
      dataSource: 'realtime',
    },
  })
}
