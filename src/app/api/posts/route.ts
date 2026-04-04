export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/posts?account=<id>&limit=20&offset=0&type=FEED|REELS|STORY
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  const limit = parseInt(searchParams.get('limit') ?? '20', 10)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)
  const mediaType = searchParams.get('type')

  if (!accountId) return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })

  // 投稿一覧 + インサイト（LEFT 相当: インサイト未収集の投稿も一覧に出す。!inner だとインサイト0件の投稿が全て落ちる）
  let query = supabase
    .from('ig_media')
    .select(`
      *,
      ig_media_insight_fact(metric_code, value, snapshot_at)
    `, { count: 'exact' })
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .order('posted_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (mediaType) {
    query = query.eq('media_product_type', mediaType)
  }

  const { data: posts, count, error } = await query

  if (error) {
    // フォールバック: インサイトなし
    const { data: plain, count: c2, error: e2 } = await supabase
      .from('ig_media')
      .select('*', { count: 'exact' })
      .eq('account_id', accountId)
      .eq('is_deleted', false)
      .order('posted_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
    return NextResponse.json({ data: plain, count: c2, offset, limit })
  }

  // 各投稿の最新インサイトを集約
  const enriched = posts?.map((post) => {
    const insights = post.ig_media_insight_fact as Array<{ metric_code: string; value: number | null; snapshot_at: string }>
    const latest: Record<string, number | null> = {}
    for (const ins of (insights ?? [])) {
      if (!(ins.metric_code in latest)) {
        latest[ins.metric_code] = ins.value
      }
    }
    const { ig_media_insight_fact: _, ...rest } = post
    return { ...rest, insights: latest }
  })

  return NextResponse.json({ data: enriched, count, offset, limit })
}
