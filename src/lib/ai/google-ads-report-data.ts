import type { SupabaseClient } from '@supabase/supabase-js'

export type GoogleAdsReportAnalysisType = 'weekly' | 'monthly'

function parseDate(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function microsToCurrency(micros: number): number {
  return micros / 1_000_000
}

export type GoogleAdsReportPayload = {
  serviceId: string
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
  daily: Array<{
    date: string
    impressions: number
    clicks: number
    cost: number
    conversions: number
    conversionValue: number
    roas: number | null
  }>
  topCampaigns: Array<{
    campaign_id: string
    campaign_name: string
    cost: number
    conversions: number
    conversionValue: number
    roas: number | null
  }>
}

export async function loadGoogleAdsReportPayload(params: {
  supabase: SupabaseClient
  serviceId: string
  analysisType: GoogleAdsReportAnalysisType
  periodStart?: string
  periodEnd?: string
}): Promise<GoogleAdsReportPayload> {
  const until =
    parseDate(params.periodEnd) ??
    toYmd(new Date(Date.now() - 24 * 60 * 60 * 1000)) // 通常同期と同じく昨日まで
  const days = params.analysisType === 'monthly' ? 30 : 7
  const since =
    parseDate(params.periodStart) ??
    toYmd(new Date(Date.now() - days * 24 * 60 * 60 * 1000))

  const { data: service, error: svcErr } = await params.supabase
    .from('services')
    .select('id, service_name, service_type')
    .eq('id', params.serviceId)
    .single()
  if (svcErr || !service) throw new Error('サービスが見つかりません')
  if (service.service_type !== 'google_ads') throw new Error('Google 広告サービスではありません')

  const { data: dailyRows, error: dErr } = await params.supabase
    .from('google_ads_campaign_daily')
    .select('date, impressions, clicks, cost_micros, conversions, conversion_value_micros')
    .eq('service_id', params.serviceId)
    .gte('date', since)
    .lte('date', until)
    .order('date', { ascending: true })
  if (dErr) throw new Error(dErr.message)

  const daily = (dailyRows ?? []).map((r) => {
    const costMicros = Number(r.cost_micros ?? 0)
    const convValueMicros = Number(r.conversion_value_micros ?? 0)
    const cost = microsToCurrency(costMicros)
    const conversionValue = microsToCurrency(convValueMicros)
    const roas = costMicros > 0 && convValueMicros > 0 ? convValueMicros / costMicros : null
    return {
      date: r.date as string,
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

  // top campaigns（費用上位）
  const { data: masters, error: mErr } = await params.supabase
    .from('google_ads_campaigns')
    .select('campaign_id, campaign_name')
    .eq('service_id', params.serviceId)
  if (mErr) throw new Error(mErr.message)

  const { data: byCampaignRows, error: bcErr } = await params.supabase
    .from('google_ads_campaign_daily')
    .select('campaign_id, cost_micros, conversions, conversion_value_micros')
    .eq('service_id', params.serviceId)
    .gte('date', since)
    .lte('date', until)
  if (bcErr) throw new Error(bcErr.message)

  const agg: Record<
    string,
    { costMicros: number; conversions: number; convValueMicros: number }
  > = {}
  for (const r of byCampaignRows ?? []) {
    const id = String(r.campaign_id ?? '')
    if (!id) continue
    const a = (agg[id] ??= { costMicros: 0, conversions: 0, convValueMicros: 0 })
    a.costMicros += Number(r.cost_micros ?? 0)
    a.conversions += Number(r.conversions ?? 0)
    a.convValueMicros += Number(r.conversion_value_micros ?? 0)
  }

  const nameMap = new Map<string, string>()
  for (const m of masters ?? []) nameMap.set(String(m.campaign_id), String(m.campaign_name ?? ''))

  const topCampaigns = Object.entries(agg)
    .map(([campaign_id, a]) => {
      const roas2 = a.costMicros > 0 && a.convValueMicros > 0 ? a.convValueMicros / a.costMicros : null
      return {
        campaign_id,
        campaign_name: nameMap.get(campaign_id) ?? campaign_id,
        cost: microsToCurrency(a.costMicros),
        conversions: a.conversions,
        conversionValue: microsToCurrency(a.convValueMicros),
        roas: roas2,
      }
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10)

  return {
    serviceId: params.serviceId,
    serviceName: String(service.service_name ?? 'Google 広告'),
    period: { start: since, end: until },
    totals: {
      impressions: sum('impressions'),
      clicks: sum('clicks'),
      cost,
      conversions: sum('conversions'),
      conversionValue,
      roas,
    },
    daily,
    topCampaigns,
  }
}

export function buildGoogleAdsReportSystemPrompt(): string {
  return [
    'あなたは広告運用の専門家です。',
    'ユーザーが意思決定できるように、数字に基づいて結論→根拠→具体アクションの順で書いてください。',
    '過度な一般論は避け、可能な限り「どの指標がどう動いたか」を明示してください。',
    '出力は日本語。Markdown で見出しと箇条書きを使って読みやすくしてください。',
  ].join('\n')
}

export function buildGoogleAdsReportUserMessage(payload: GoogleAdsReportPayload): string {
  return [
    `以下の Google 広告データを分析し、日本語でレポートを作成してください。`,
    ``,
    `【サービス】${payload.serviceName}`,
    `【分析期間】${payload.period.start} 〜 ${payload.period.end}（昨日まで）`,
    ``,
    `【全体サマリ】`,
    `- 表示回数: ${payload.totals.impressions}`,
    `- クリック: ${payload.totals.clicks}`,
    `- 費用: ${payload.totals.cost.toFixed(0)}`,
    `- CV: ${payload.totals.conversions}`,
    `- CV価値: ${payload.totals.conversionValue.toFixed(0)}`,
    `- ROAS: ${payload.totals.roas != null ? payload.totals.roas.toFixed(2) : '—'}`,
    ``,
    `【日次推移（配列）】`,
    JSON.stringify(payload.daily),
    ``,
    `【費用上位キャンペーン（最大10件）】`,
    JSON.stringify(payload.topCampaigns),
    ``,
    `【分析の観点】`,
    `1) 予算消化と成果（費用・CV・CV価値・ROAS）の状況と改善余地`,
    `2) 直近での変動点（急増/急減）と仮説`,
    `3) 次の7日でやるべき優先アクション（3〜7個、具体的に）`,
  ].join('\n')
}

