export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sortSimilarCandidates } from '@/lib/instagram/post-insight-chart'
import type { IgMedia } from '@/types'

// GET /api/posts/[id]/similar — 同一アカウントの類似投稿候補（種別一致を優先）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(30, Math.max(1, Number(searchParams.get('limit') ?? 12) || 12))

  const { data: base, error: baseErr } = await supabase
    .from('ig_media')
    .select('id, account_id, media_product_type, media_type')
    .eq('id', id)
    .single()

  if (baseErr || !base) {
    return NextResponse.json({ error: '投稿が見つかりません' }, { status: 404 })
  }

  const { data: rows, error } = await supabase
    .from('ig_media')
    .select('id, posted_at, thumbnail_url, caption, media_product_type, media_type')
    .eq('account_id', base.account_id)
    .neq('id', id)
    .eq('is_deleted', false)
    .order('posted_at', { ascending: false })
    .limit(Math.max(limit * 3, 24))

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const typed = (rows ?? []) as Pick<
    IgMedia,
    'id' | 'posted_at' | 'thumbnail_url' | 'caption' | 'media_product_type' | 'media_type'
  >[]
  const sorted = sortSimilarCandidates(base, typed).slice(0, limit)

  return NextResponse.json({ posts: sorted })
}
