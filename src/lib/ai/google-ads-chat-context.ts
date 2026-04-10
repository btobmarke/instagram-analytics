import type { SupabaseClient } from '@supabase/supabase-js'

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function microsToCurrency(micros: number): number {
  return micros / 1_000_000
}

export type GoogleAdsChatContext = {
  serviceName: string
  period: { start: string; end: string }
  totals: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    conversionValue: number
    roas: number | null
  }
  topCampaigns: Array<{ name: string; cost: number; conversions: number; roas: number | null }>
}

export async function loadGoogleAdsChatContext(params: {
  supabase: SupabaseClient
  serviceId: string
}): Promise<GoogleAdsChatContext> {
  const until = toYmd(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const since = toYmd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))

  const { data: service, error: svcErr } = await params.supabase
    .from('services')
    .select('id, service_name, service_type')
    .eq('id', params.serviceId)
    .single()
  if (svcErr || !service) throw new Error('サービスが見つかりません')
  if (service.service_type !== 'google_ads') throw new Error('Google 広告サービスではありません')

  const { data: dailyRows, error: dErr } = await params.supabase
    .from('google_ads_campaign_daily')
    .select('impressions, clicks, cost_micros, conversions, conversion_value_micros')
    .eq('service_id', params.serviceId)
    .gte('date', since)
    .lte('date', until)
  if (dErr) throw new Error(dErr.message)

  let impressions = 0
  let clicks = 0
  let costMicros = 0
  let conversions = 0
  let conversionValueMicros = 0
  for (const r of dailyRows ?? []) {
    impressions += Number(r.impressions ?? 0)
    clicks += Number(r.clicks ?? 0)
    costMicros += Number(r.cost_micros ?? 0)
    conversions += Number(r.conversions ?? 0)
    conversionValueMicros += Number(r.conversion_value_micros ?? 0)
  }
  const cost = microsToCurrency(costMicros)
  const conversionValue = microsToCurrency(conversionValueMicros)
  const roas = costMicros > 0 && conversionValueMicros > 0 ? conversionValueMicros / costMicros : null

  // top campaigns by cost
  const { data: masters, error: mErr } = await params.supabase
    .from('google_ads_campaigns')
    .select('campaign_id, campaign_name')
    .eq('service_id', params.serviceId)
  if (mErr) throw new Error(mErr.message)
  const nameMap = new Map<string, string>()
  for (const m of masters ?? []) nameMap.set(String(m.campaign_id), String(m.campaign_name ?? ''))

  const { data: byCampaignRows, error: bcErr } = await params.supabase
    .from('google_ads_campaign_daily')
    .select('campaign_id, cost_micros, conversions, conversion_value_micros')
    .eq('service_id', params.serviceId)
    .gte('date', since)
    .lte('date', until)
  if (bcErr) throw new Error(bcErr.message)

  const agg: Record<string, { costMicros: number; conversions: number; convValueMicros: number }> = {}
  for (const r of byCampaignRows ?? []) {
    const id = String(r.campaign_id ?? '')
    if (!id) continue
    const a = (agg[id] ??= { costMicros: 0, conversions: 0, convValueMicros: 0 })
    a.costMicros += Number(r.cost_micros ?? 0)
    a.conversions += Number(r.conversions ?? 0)
    a.convValueMicros += Number(r.conversion_value_micros ?? 0)
  }

  const topCampaigns = Object.entries(agg)
    .map(([id, a]) => {
      const roas2 = a.costMicros > 0 && a.convValueMicros > 0 ? a.convValueMicros / a.costMicros : null
      return {
        name: nameMap.get(id) ?? id,
        cost: microsToCurrency(a.costMicros),
        conversions: a.conversions,
        roas: roas2,
      }
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8)

  return {
    serviceName: String(service.service_name ?? 'Google 広告'),
    period: { start: since, end: until },
    totals: { impressions, clicks, cost, conversions, conversionValue, roas },
    topCampaigns,
  }
}

export function buildGoogleAdsChatSystemPrompt(ctx: GoogleAdsChatContext): string {
  const top = ctx.topCampaigns
    .map((c, i) => `- ${i + 1}. ${c.name}: 費用=${c.cost.toFixed(0)}, CV=${c.conversions}, ROAS=${c.roas != null ? c.roas.toFixed(2) : '—'}`)
    .join('\n')

  return [
    'あなたは Google 広告の運用コンサルタントです。出力は日本語で、結論→根拠→具体アクションの順に書きます。',
    '与えられたデータの範囲を超える断定は避け、必要なら追加で確認すべき点も質問してください。',
    '',
    `【対象サービス】${ctx.serviceName}`,
    `【参照期間】${ctx.period.start} 〜 ${ctx.period.end}（直近30日・昨日まで）`,
    `【全体】表示回数=${ctx.totals.impressions}, クリック=${ctx.totals.clicks}, 費用=${ctx.totals.cost.toFixed(0)}, CV=${ctx.totals.conversions}, CV価値=${ctx.totals.conversionValue.toFixed(0)}, ROAS=${ctx.totals.roas != null ? ctx.totals.roas.toFixed(2) : '—'}`,
    '【費用上位キャンペーン】',
    top || '（データなし）',
  ].join('\n')
}

