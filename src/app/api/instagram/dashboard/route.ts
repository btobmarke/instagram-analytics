export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  buildInstagramDashboardData,
  type DashboardPeriod,
} from '@/lib/instagram/dashboard-data'

// GET /api/instagram/dashboard?account=<uuid>&period=7d|30d|90d
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  const period = (searchParams.get('period') ?? '30d') as DashboardPeriod

  if (!accountId) {
    return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })
  }
  if (!['7d', '30d', '90d'].includes(period)) {
    return NextResponse.json({ error: 'period は 7d / 30d / 90d のいずれかです' }, { status: 400 })
  }

  try {
    const data = await buildInstagramDashboardData(supabase, accountId, period)
    return NextResponse.json({ data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[instagram/dashboard]', e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
