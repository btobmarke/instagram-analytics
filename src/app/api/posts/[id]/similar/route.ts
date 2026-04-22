export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sortSimilarCandidates } from '@/lib/instagram/post-insight-chart'
import { isStoryMedia } from '@/lib/instagram/post-display-mode'
import type { IgMedia } from '@/types'

// GET /api/posts/[id]/similar — 同一アカウントの類似投稿候補（ストーリーはストーリーのみ、それ以外はストーリーを除く）
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

  let q = supabase
    .from('ig_media')
    .select('id, posted_at, thumbnail_url, caption, media_product_type, media_type')
    .eq('account_id', base.account_id)
    .neq('id', id)
    .eq('is_deleted', false)
    .order('posted_at', { ascending: false })
    .limit(Math.max(limit * 3, 24))

  if (isStoryMedia(base)) {
    q = q.eq('media_product_type', 'STORY')
  } else {
    q = q.neq('media_product_type', 'STORY')
  }

  const { data: rows, error } = await q

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const typed = (rows ?? []) as Pick<
    IgMedia,
    'id' | 'posted_at' | 'thumbnail_url' | 'caption' | 'media_product_type' | 'media_type'
  >[]
  const sorted = (isStoryMedia(base) ? typed : sortSimilarCandidates(base, typed)).slice(0, limit)

  return NextResponse.json({ posts: sorted })
}
