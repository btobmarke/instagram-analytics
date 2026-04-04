export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/utils/crypto'

// GET /api/accounts/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ig_accounts')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ data })
}

// PATCH /api/accounts/[id]
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as Record<string, unknown>
  const allowed = [
    'account_name', 'biography', 'website', 'status', 'display_order',
    'api_base_url', 'api_version', 'username', 'platform_account_id',
    'facebook_page_id', 'account_type',
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('ig_accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const newToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''
  if (newToken.length > 0) {
    const admin = createSupabaseAdminClient()
    const enc = encrypt(newToken)
    const { error: tokenErr } = await admin
      .from('ig_account_tokens')
      .update({
        access_token_enc: enc,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', id)
      .eq('is_active', true)

    if (tokenErr) {
      return NextResponse.json({ error: `アカウントは更新しましたがトークン更新に失敗: ${tokenErr.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ data })
}

// DELETE /api/accounts/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('ig_accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
