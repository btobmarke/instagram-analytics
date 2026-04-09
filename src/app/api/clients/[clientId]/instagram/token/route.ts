export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/utils/crypto'

type Ctx = { params: Promise<{ clientId: string }> }

// GET /api/clients/[clientId]/instagram/token
// トークン登録状況を返す（実トークン値は返さない）
export async function GET(_req: Request, { params }: Ctx) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('client_ig_tokens')
    .select('id, client_id, token_type, expires_at, is_active, last_verified_at, created_at, updated_at')
    .eq('client_id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ success: true, data: null })
  }

  return NextResponse.json({ success: true, data })
}

// POST /api/clients/[clientId]/instagram/token
// トークン登録（既存があれば上書き）
export async function POST(req: Request, { params }: Ctx) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { access_token, expires_at } = body

  if (!access_token || typeof access_token !== 'string' || !access_token.trim()) {
    return NextResponse.json({ error: 'access_token は必須です' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const enc = encrypt(access_token.trim())
  const now = new Date().toISOString()

  // upsert（client_id UNIQUE 制約を利用）
  const { data, error } = await admin
    .from('client_ig_tokens')
    .upsert({
      client_id: clientId,
      access_token_enc: enc,
      token_type: 'long_lived',
      is_active: true,
      expires_at: expires_at ?? null,
      updated_at: now,
    }, { onConflict: 'client_id' })
    .select('id, client_id, token_type, expires_at, is_active, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}

// DELETE /api/clients/[clientId]/instagram/token
// トークン削除
export async function DELETE(_req: Request, { params }: Ctx) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('client_ig_tokens')
    .delete()
    .eq('client_id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
