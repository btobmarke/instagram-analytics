import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/services/:serviceId/gbp/performance
// クエリ: ?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end   = searchParams.get('end')

  // gbp_site_id を取得
  const { data: site } = await supabase
    .from('gbp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()

  if (!site) {
    return NextResponse.json({ success: false, error: 'ロケーションが未登録です' }, { status: 404 })
  }

  let query = supabase
    .from('gbp_performance_daily')
    .select('*')
    .eq('gbp_site_id', site.id)
    .order('date', { ascending: false })

  if (start) query = query.gte('date', start)
  if (end)   query = query.lte('date', end)

  const { data, error } = await query.limit(90)  // 最大90日

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}
