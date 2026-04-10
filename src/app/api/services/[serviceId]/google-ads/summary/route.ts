import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

function parseDate(s: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

function microsToCurrency(micros: number): number {
  return micros / 1_000_000
}

// GET /api/services/:serviceId/google-ads/summary?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const start = parseDate(searchParams.get('start'))
  const end = parseDate(searchParams.get('end'))
  if (!start || !end) {
    return NextResponse.json({ error: 'start/end (YYYY-MM-DD) は必須です' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data: rows, error } = await admin
    .from('google_ads_campaign_daily')
    .select('date, impressions, clicks, cost_micros, conversions, conversion_value_micros')
    .eq('service_id', serviceId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const daily = (rows ?? []).map((r) => {
    const costMicros = Number(r.cost_micros ?? 0)
    const convValueMicros = Number(r.conversion_value_micros ?? 0)
    const cost = microsToCurrency(costMicros)
    const conversionValue = microsToCurrency(convValueMicros)
    const roas = costMicros > 0 && convValueMicros > 0 ? convValueMicros / costMicros : null
    return {
      date: r.date,
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      cost,
      conversions: Number(r.conversions ?? 0),
      conversionValue,
      roas,
    }
  })

  const sum = <K extends keyof (typeof daily)[number]>(k: K): number =>
    daily.reduce((acc, cur) => acc + (Number(cur[k]) || 0), 0)

  const cost = sum('cost')
  const conversionValue = sum('conversionValue')
  const roas = cost > 0 && conversionValue > 0 ? conversionValue / cost : null

  return NextResponse.json({
    success: true,
    data: {
      start,
      end,
      impressions: sum('impressions'),
      clicks: sum('clicks'),
      cost,
      conversions: sum('conversions'),
      conversionValue,
      roas,
      daily,
    },
  })
}

