import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

function microsToCurrency(micros: number): number {
  return micros / 1_000_000
}

// GET /api/services/:serviceId/google-ads/campaigns
// キャンペーン一覧（マスタ + 直近30日集計）
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data: masters, error: mErr } = await admin
    .from('google_ads_campaigns')
    .select('campaign_id, campaign_name, status, campaign_type, budget_amount_micros, bidding_strategy, start_date, end_date')
    .eq('service_id', serviceId)
    .order('campaign_name', { ascending: true })

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  const { data: daily, error: dErr } = await admin
    .from('google_ads_campaign_daily')
    .select('campaign_id, impressions, clicks, cost_micros, conversions, conversion_value_micros')
    .eq('service_id', serviceId)
    .gte('date', sinceStr)

  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

  const agg: Record<string, { impressions: number; clicks: number; costMicros: number; conversions: number; convValueMicros: number }> = {}
  for (const r of daily ?? []) {
    const id = r.campaign_id as string
    const a = (agg[id] ??= { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, convValueMicros: 0 })
    a.impressions += Number(r.impressions ?? 0)
    a.clicks += Number(r.clicks ?? 0)
    a.costMicros += Number(r.cost_micros ?? 0)
    a.conversions += Number(r.conversions ?? 0)
    a.convValueMicros += Number(r.conversion_value_micros ?? 0)
  }

  const rows = (masters ?? []).map((m) => {
    const a = agg[m.campaign_id] ?? { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, convValueMicros: 0 }
    const cost = microsToCurrency(a.costMicros)
    const conversionValue = microsToCurrency(a.convValueMicros)
    const roas = a.costMicros > 0 && a.convValueMicros > 0 ? a.convValueMicros / a.costMicros : null
    return {
      ...m,
      budget_amount: m.budget_amount_micros != null ? microsToCurrency(Number(m.budget_amount_micros)) : null,
      last30d: {
        impressions: a.impressions,
        clicks: a.clicks,
        cost,
        conversions: a.conversions,
        conversionValue,
        roas,
      },
    }
  })

  return NextResponse.json({ success: true, data: rows })
}

