import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/services/:serviceId/gbp/search-keywords
// クエリ: ?year=YYYY&month=M（省略時は DB 内の最新年月）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const yearParam  = searchParams.get('year')
  const monthParam = searchParams.get('month')
  const hasYear  = yearParam != null && yearParam !== ''
  const hasMonth = monthParam != null && monthParam !== ''
  if (hasYear !== hasMonth) {
    return NextResponse.json(
      { success: false, error: 'year と month はセットで指定するか、両方省略してください' },
      { status: 400 },
    )
  }

  const { data: site, error: siteErr } = await supabase
    .from('gbp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()

  if (siteErr || !site) {
    return NextResponse.json({ success: false, error: 'ロケーションが未登録です' }, { status: 404 })
  }

  let year: number
  let month: number

  if (hasYear && hasMonth) {
    year = parseInt(yearParam!, 10)
    month = parseInt(monthParam!, 10)
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ success: false, error: 'year / month が不正です' }, { status: 400 })
    }
  } else {
    const { data: latest } = await supabase
      .from('gbp_search_keyword_monthly')
      .select('year, month')
      .eq('gbp_site_id', site.id)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latest) {
      return NextResponse.json({ success: true, data: [], meta: { year: null, month: null } })
    }
    year = latest.year
    month = latest.month
  }

  const { data, error } = await supabase
    .from('gbp_search_keyword_monthly')
    .select('search_keyword, impressions, threshold, year, month')
    .eq('gbp_site_id', site.id)
    .eq('year', year)
    .eq('month', month)
    .order('impressions', { ascending: false, nullsFirst: false })
    .limit(200)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: data ?? [],
    meta: { year, month },
  })
}
