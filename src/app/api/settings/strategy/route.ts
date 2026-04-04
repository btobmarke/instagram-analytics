export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/settings/strategy?account=<id>
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  if (!accountId) return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })

  const { data } = await supabase
    .from('account_strategy_settings')
    .select('*')
    .eq('account_id', accountId)
    .single()

  return NextResponse.json({ data })
}

// PUT /api/settings/strategy?account=<id>
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  if (!accountId) return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })

  const body = await request.json()
  const { strategy_text } = body

  const { error } = await supabase
    .from('account_strategy_settings')
    .upsert({ account_id: accountId, strategy_text, updated_at: new Date().toISOString() })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
