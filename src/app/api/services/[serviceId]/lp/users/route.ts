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
 * GET /api/services/:serviceId/lp/users
 * LP ユーザー一覧取得 API
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

  // LP Site 取得
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
  const temperature = searchParams.get('temperature') // 'hot' | 'cold' | null
  const keyword = searchParams.get('keyword')
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('page_size') ?? 20)))
  const from = (page - 1) * pageSize

  const rangeStart = getRangeStart(rangeParam)

  let query = supabase
    .from('lp_users')
    .select(
      'id, anonymous_key, first_visited_at, last_visited_at, visit_count, total_intent_score, user_temperature, user_agent',
      { count: 'exact' }
    )
    .eq('lp_site_id', lpSite.id)
    .order('last_visited_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (rangeStart) query = query.gte('last_visited_at', rangeStart)
  if (temperature) query = query.eq('user_temperature', temperature)
  if (keyword) query = query.ilike('anonymous_key', `%${keyword}%`)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: 'データ取得に失敗しました' } }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: (data ?? []).map(u => ({
      userId: u.id,
      anonymousKey: u.anonymous_key,
      firstVisitedAt: u.first_visited_at,
      lastVisitedAt: u.last_visited_at,
      visitCount: u.visit_count,
      totalIntentScore: u.total_intent_score,
      userTemperature: u.user_temperature,
    })),
    meta: { page, pageSize, totalCount: count ?? 0 },
  })
}
