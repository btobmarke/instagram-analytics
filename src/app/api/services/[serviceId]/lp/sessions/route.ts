import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const VALID_RANGES = ['all', '30d', '7d', 'today'] as const
type RangeType = typeof VALID_RANGES[number]

function getRangeStart(range: RangeType): string | null {
  const now = new Date()
  switch (range) {
    case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    case 'all': return null
  }
}

/**
 * GET /api/services/:serviceId/lp/sessions
 * LP セッション一覧取得 API
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })
  }

  const { data: lpSite } = await supabase
    .from('lp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()

  if (!lpSite) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'LPサービスが見つかりません' } }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const rangeParam = (searchParams.get('range') ?? '30d') as RangeType
  const referrer = searchParams.get('referrer')
  const scoreMin = searchParams.get('score_min') ? Number(searchParams.get('score_min')) : undefined
  const scoreMax = searchParams.get('score_max') ? Number(searchParams.get('score_max')) : undefined
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('page_size') ?? 20)))
  const from = (page - 1) * pageSize

  const rangeStart = getRangeStart(rangeParam)

  let query = supabase
    .from('lp_sessions')
    .select(
      'id, lp_user_id, started_at, ended_at, duration_seconds, session_intent_score, interaction_count, referrer_source, landing_page_url',
      { count: 'exact' }
    )
    .eq('lp_site_id', lpSite.id)
    .order('started_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (rangeStart) query = query.gte('started_at', rangeStart)
  if (referrer) query = query.eq('referrer_source', referrer)
  if (scoreMin !== undefined) query = query.gte('session_intent_score', scoreMin)
  if (scoreMax !== undefined) query = query.lte('session_intent_score', scoreMax)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: 'データ取得に失敗しました' } }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: (data ?? []).map(s => ({
      sessionId: s.id,
      userId: s.lp_user_id,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      durationSeconds: s.duration_seconds,
      sessionIntentScore: s.session_intent_score,
      interactionCount: s.interaction_count,
      referrerSource: s.referrer_source,
      landingPageUrl: s.landing_page_url,
    })),
    meta: { page, pageSize, totalCount: count ?? 0 },
  })
}
