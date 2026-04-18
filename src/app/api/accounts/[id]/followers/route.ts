export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { parseFollowerUsernamesFromPaste } from '@/lib/instagram/parse-follower-usernames-from-paste'

const MAX_FOLLOWERS = 100_000
const IG_USERNAME_RE = /^[a-z0-9._]{1,30}$/

function normalizeUsernameListFromArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of arr) {
    if (typeof item !== 'string') continue
    const u = item.trim().replace(/^@+/, '').toLowerCase()
    if (!u || !IG_USERNAME_RE.test(u) || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

/** GET /api/accounts/[id]/followers — 保存件数と最終更新 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { count, error: cErr } = await supabase
    .from('ig_account_follower_usernames')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', id)

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const { data: maxRow } = await supabase
    .from('ig_account_follower_usernames')
    .select('updated_at')
    .eq('account_id', id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    count: count ?? 0,
    last_updated_at: maxRow?.updated_at ?? null,
  })
}

/** DELETE /api/accounts/[id]/followers — 当該アカウントの保存済みフォロワー一覧をすべて削除 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: acct, error: aErr } = await supabase.from('ig_accounts').select('id').eq('id', id).maybeSingle()
  if (aErr || !acct) return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })

  const { count: before, error: cErr } = await supabase
    .from('ig_account_follower_usernames')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', id)
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const { error: delErr } = await supabase.from('ig_account_follower_usernames').delete().eq('account_id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({
    count: 0,
    deleted: before ?? 0,
    last_updated_at: null,
  })
}

/** PUT /api/accounts/[id]/followers — `usernames` 配列、または従来の `raw` テキストで全件置換 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON が不正です' }, { status: 400 })
  }

  const b = body as { usernames?: unknown; raw?: unknown }
  let usernames: string[]

  if (Array.isArray(b.usernames)) {
    usernames = normalizeUsernameListFromArray(b.usernames)
    if (!usernames.length) {
      return NextResponse.json({ error: 'usernames が空か、有効なユーザー名がありません' }, { status: 400 })
    }
  } else {
    const raw = typeof b.raw === 'string' ? b.raw : ''
    if (!raw.trim()) {
      return NextResponse.json(
        { error: 'usernames 配列か raw（プレーンテキスト）のいずれかが必要です' },
        { status: 400 }
      )
    }
    usernames = parseFollowerUsernamesFromPaste(raw)
    if (!usernames.length) {
      return NextResponse.json({ error: 'ユーザー名を検出できませんでした' }, { status: 400 })
    }
  }
  if (usernames.length > MAX_FOLLOWERS) {
    return NextResponse.json({ error: `最大 ${MAX_FOLLOWERS.toLocaleString()} 件までです` }, { status: 400 })
  }

  const { data: acct, error: aErr } = await supabase.from('ig_accounts').select('id').eq('id', id).maybeSingle()
  if (aErr || !acct) return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })

  const now = new Date().toISOString()
  const { error: delErr } = await supabase.from('ig_account_follower_usernames').delete().eq('account_id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  const rows = usernames.map((username) => ({
    account_id: id,
    username,
    updated_at: now,
  }))

  const chunk = 500
  for (let off = 0; off < rows.length; off += chunk) {
    const slice = rows.slice(off, off + chunk)
    const { error: insErr } = await supabase.from('ig_account_follower_usernames').insert(slice)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ count: usernames.length, last_updated_at: now })
}
