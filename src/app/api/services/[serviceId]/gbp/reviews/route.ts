import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/services/:serviceId/gbp/reviews
// クエリ: ?page=1&per_page=20&star_rating=FIVE
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page     = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const perPage  = Math.min(50, Number(searchParams.get('per_page') ?? '20'))
  const rating   = searchParams.get('star_rating')

  // gbp_site_id を取得
  const { data: site } = await supabase
    .from('gbp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()

  if (!site) {
    return NextResponse.json({ success: false, error: 'ロケーションが未登録です' }, { status: 404 })
  }

  const from = (page - 1) * perPage
  const to   = from + perPage - 1

  let query = supabase
    .from('gbp_reviews')
    .select('*', { count: 'exact' })
    .eq('gbp_site_id', site.id)
    .order('create_time', { ascending: false })
    .range(from, to)

  if (rating) query = query.eq('star_rating', rating)

  const { data, error, count } = await query

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: data ?? [],
    meta: { page, per_page: perPage, total: count ?? 0 },
  })
}
