export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET /api/accounts — アカウント一覧取得
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ig_accounts')
    .select('*')
    .order('display_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST /api/accounts — アカウント新規登録
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    platform_account_id, username, account_name, account_type,
    facebook_page_id,
    api_base_url, api_version,
  } = body

  if (!platform_account_id || !username) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  // アカウント登録
  const { data: account, error: accountError } = await admin
    .from('ig_accounts')
    .insert({
      platform_account_id,
      username,
      account_name: account_name ?? username,
      account_type: account_type ?? 'BUSINESS',
      facebook_page_id: facebook_page_id ?? null,
      api_base_url: api_base_url ?? 'https://graph.facebook.com',
      api_version: api_version ?? 'v22.0',
      status: 'active',
    })
    .select()
    .single()

  if (accountError) {
    if (accountError.code === '23505') {
      return NextResponse.json({ error: 'このアカウントはすでに登録されています' }, { status: 409 })
    }
    return NextResponse.json({ error: accountError.message }, { status: 500 })
  }

  // 戦略・KPI設定の初期化
  await admin.from('account_strategy_settings').insert({ account_id: account.id })
  await admin.from('account_kpi_settings').insert({ account_id: account.id })

  return NextResponse.json({ data: account }, { status: 201 })
}
