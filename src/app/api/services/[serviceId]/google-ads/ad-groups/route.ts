import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

function microsToCurrency(micros: number): number {
  return micros / 1_000_000
}

// GET /api/services/:serviceId/google-ads/ad-groups?campaignId=xxx
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaignId = request.nextUrl.searchParams.get('campaignId')?.trim() ?? ''
  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId は必須です' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data: masters, error: mErr } = await admin
    .from('google_ads_ad_groups')
    .select('campaign_id, ad_group_id, ad_group_name, status, cpc_bid_micros')
    .eq('service_id', serviceId)
    .eq('campaign_id', campaignId)
    .order('ad_group_name', { ascending: true })

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  const { data: daily, error: dErr } = await admin
    .from('google_ads_adgroup_daily')
    .select('ad_group_id, impressions, clicks, cost_micros, conversions, conversion_value_micros')
    .eq('service_id', serviceId)
    .eq('campaign_id', campaignId)
    .gte('date', sinceStr)

  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

  const agg: Record<string, { impressions: number; clicks: number; costMicros: number; conversions: number; convValueMicros: number }> = {}
  for (const r of daily ?? []) {
    const id = r.ad_group_id as string
    const a = (agg[id] ??= { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, convValueMicros: 0 })
    a.impressions += Number(r.impressions ?? 0)
    a.clicks += Number(r.clicks ?? 0)
    a.costMicros += Number(r.cost_micros ?? 0)
    a.conversions += Number(r.conversions ?? 0)
    a.convValueMicros += Number(r.conversion_value_micros ?? 0)
  }

  const rows = (masters ?? []).map((m) => {
    const a = agg[m.ad_group_id] ?? { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, convValueMicros: 0 }
    const cost = microsToCurrency(a.costMicros)
    const conversionValue = microsToCurrency(a.convValueMicros)
    const roas = a.costMicros > 0 && a.convValueMicros > 0 ? a.convValueMicros / a.costMicros : null
    return {
      ...m,
      cpc_bid: m.cpc_bid_micros != null ? microsToCurrency(Number(m.cpc_bid_micros)) : null,
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

