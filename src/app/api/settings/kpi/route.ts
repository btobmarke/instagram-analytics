export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/settings/kpi?account=<id>
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  if (!accountId) return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })

  const [{ data: kpiSettings }, { data: kpiMasters }, { data: kpiTargets }] = await Promise.all([
    supabase.from('account_kpi_settings').select('*').eq('account_id', accountId).single(),
    supabase.from('kpi_master').select('*').eq('is_active', true).order('category').order('display_order'),
    supabase.from('kpi_target').select('*').eq('account_id', accountId),
  ])

  return NextResponse.json({ data: { kpi_settings: kpiSettings, kpi_masters: kpiMasters, kpi_targets: kpiTargets } })
}

// PUT /api/settings/kpi?account=<id>
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  if (!accountId) return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })

  const body = await request.json()
  const { kpi_settings, kpi_targets } = body

  // KPI設定更新
  if (kpi_settings) {
    const { error } = await supabase
      .from('account_kpi_settings')
      .upsert({ ...kpi_settings, account_id: accountId, updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // KPI目標値のアップサート
  if (kpi_targets && Array.isArray(kpi_targets)) {
    for (const target of kpi_targets) {
      if (target.id) {
        await supabase.from('kpi_target').update(target).eq('id', target.id)
      } else {
        await supabase.from('kpi_target').insert({ ...target, account_id: accountId })
      }
    }
  }

  return NextResponse.json({ success: true })
}
