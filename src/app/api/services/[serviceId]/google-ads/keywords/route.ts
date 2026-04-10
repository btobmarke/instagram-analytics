import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

function microsToCurrency(micros: number): number {
  return micros / 1_000_000
}

// GET /api/services/:serviceId/google-ads/keywords?adGroupId=xxx
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adGroupId = request.nextUrl.searchParams.get('adGroupId')?.trim() ?? ''
  if (!adGroupId) {
    return NextResponse.json({ error: 'adGroupId は必須です' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data: cfg } = await admin
    .from('google_ads_service_configs')
    .select('collect_keywords')
    .eq('service_id', serviceId)
    .single()

  if (!cfg || !cfg.collect_keywords) {
    return NextResponse.json({ error: 'このサービスではキーワード収集が無効です' }, { status: 400 })
  }

  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data: masters, error: mErr } = await admin
    .from('google_ads_keywords')
    .select('ad_group_id, keyword_id, keyword_text, match_type, status, quality_score')
    .eq('service_id', serviceId)
    .eq('ad_group_id', adGroupId)
    .order('quality_score', { ascending: true, nullsFirst: false })

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  const { data: daily, error: dErr } = await admin
    .from('google_ads_keyword_daily')
    .select('keyword_id, impressions, clicks, cost_micros, conversions, conversion_value_micros')
    .eq('service_id', serviceId)
    .eq('ad_group_id', adGroupId)
    .gte('date', sinceStr)

  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

  const agg: Record<string, { impressions: number; clicks: number; costMicros: number; conversions: number; convValueMicros: number }> = {}
  for (const r of daily ?? []) {
    const id = r.keyword_id as string
    const a = (agg[id] ??= { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, convValueMicros: 0 })
    a.impressions += Number(r.impressions ?? 0)
    a.clicks += Number(r.clicks ?? 0)
    a.costMicros += Number(r.cost_micros ?? 0)
    a.conversions += Number(r.conversions ?? 0)
    a.convValueMicros += Number(r.conversion_value_micros ?? 0)
  }

  const rows = (masters ?? []).map((m) => {
    const a = agg[m.keyword_id] ?? { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, convValueMicros: 0 }
    const cost = microsToCurrency(a.costMicros)
    const conversionValue = microsToCurrency(a.convValueMicros)
    const roas = a.costMicros > 0 && a.convValueMicros > 0 ? a.convValueMicros / a.costMicros : null
    const ctr = a.impressions > 0 ? a.clicks / a.impressions : null
    const cpc = a.clicks > 0 ? cost / a.clicks : null
    return {
      ...m,
      last30d: {
        impressions: a.impressions,
        clicks: a.clicks,
        cost,
        conversions: a.conversions,
        conversionValue,
        roas,
        ctr,
        cpc,
      },
    }
  })

  return NextResponse.json({ success: true, data: rows })
}

