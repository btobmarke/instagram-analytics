import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const nullablePct = z.number().min(0).max(100).nullish()
const nullableInt = z.number().int().min(0).nullish()

const likedUsernamesField = z
  .union([z.array(z.string()), z.null(), z.undefined()])
  .optional()
  .transform((v): string[] | undefined => {
    if (!v || !Array.isArray(v)) return undefined
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of v) {
      const u = String(raw).trim().replace(/^@+/, '').toLowerCase()
      if (!/^[a-z0-9._]{1,30}$/.test(u)) continue
      if (seen.has(u)) continue
      seen.add(u)
      if (out.length >= 3000) break
      out.push(u)
    }
    return out.length ? out : undefined
  })

const PostBodySchema = z.object({
  views_follower_pct: nullablePct,
  views_non_follower_pct: nullablePct,
  interactions_follower_pct: nullablePct,
  interactions_non_follower_pct: nullablePct,
  views_from_home: nullableInt,
  views_from_profile: nullableInt,
  views_from_other: nullableInt,
  liked_usernames: likedUsernamesField,
  note: z.string().max(2000).nullable().optional(),
})

function hasAnyMetric(body: z.infer<typeof PostBodySchema>): boolean {
  return (
    body.views_follower_pct != null ||
    body.views_non_follower_pct != null ||
    body.interactions_follower_pct != null ||
    body.interactions_non_follower_pct != null ||
    body.views_from_home != null ||
    body.views_from_profile != null ||
    body.views_from_other != null ||
    (body.liked_usernames != null && body.liked_usernames.length > 0) ||
    (body.note != null && body.note.trim().length > 0)
  )
}

async function assertPostAccessible(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, mediaId: string) {
  const { data: post, error } = await supabase.from('ig_media').select('id').eq('id', mediaId).single()
  if (error || !post) return { ok: false as const, status: 404 as const, message: '投稿が見つかりません' }
  return { ok: true as const }
}

/** GET /api/posts/[id]/manual-insight-extra */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertPostAccessible(supabase, id)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await supabase
    .from('ig_media_manual_insight_extra')
    .select('*')
    .eq('media_id', id)
    .order('recorded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

/** POST /api/posts/[id]/manual-insight-extra */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertPostAccessible(supabase, id)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const json = await req.json().catch(() => null)
  const parsed = PostBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? '入力が不正です' },
      { status: 400 }
    )
  }

  if (!hasAnyMetric(parsed.data)) {
    return NextResponse.json(
      { error: '数値またはメモのいずれかを1つ以上入力してください' },
      { status: 400 }
    )
  }

  const row = {
    media_id: id,
    views_follower_pct: parsed.data.views_follower_pct,
    views_non_follower_pct: parsed.data.views_non_follower_pct,
    interactions_follower_pct: parsed.data.interactions_follower_pct,
    interactions_non_follower_pct: parsed.data.interactions_non_follower_pct,
    views_from_home: parsed.data.views_from_home,
    views_from_profile: parsed.data.views_from_profile,
    views_from_other: parsed.data.views_from_other,
    liked_usernames: parsed.data.liked_usernames ?? null,
    note: parsed.data.note?.trim() || null,
  }

  const { data, error } = await supabase.from('ig_media_manual_insight_extra').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
