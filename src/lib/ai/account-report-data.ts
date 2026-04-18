import type { SupabaseClient } from '@supabase/supabase-js'
import type { IgMedia, KpiMaster, KpiProgress } from '@/types'
import { buildInstagramServiceKpiPromptBlock } from '@/lib/ai/instagram-service-kpis-for-prompt'

export type AccountReportAnalysisType = 'weekly' | 'monthly'

export interface AccountReportPromptPayload {
  accountUsername: string
  since: string
  until: string
  analysisType: AccountReportAnalysisType
  weeklySummary: Record<string, unknown>
  /** サービス詳細「KPI設定」（instagram_service_kpis）をテキスト化したもの */
  serviceKpiPromptBlock: string
  kpiProgress: KpiProgress[]
  kpiMasters: KpiMaster[]
  kpiResultKpiIds: Map<string, string | null>
  topPosts: Array<{ post: IgMedia; insights: Record<string, number | null> }>
  promptText: string
  accountStrategy: string
}

function buildSystemPrompt(analysisPrompt: string, strategy: string): string {
  return `あなたはInstagramマーケティングの専門家です。
データに基づいて具体的・実践的なアドバイスを提供してください。

【分析観点】
${analysisPrompt}

【アカウント戦略】
${strategy || '（戦略未設定）'}`
}

export function buildAccountReportUserMessage(p: AccountReportPromptPayload): string {
  const analysisLabel = p.analysisType === 'weekly' ? '週次' : '月次'

  const kpiLines = p.kpiProgress.map((row) => {
    const kpiId = row.kpi_result_id ? p.kpiResultKpiIds.get(row.kpi_result_id) : null
    const kpi = kpiId ? p.kpiMasters.find((k) => k.id === kpiId) : undefined
    return `${kpi?.kpi_name ?? 'KPI'}: 実績 ${row.actual_value} / 目標 ${row.target_value} (達成率 ${row.achievement_rate?.toFixed(1)}%)`
  })

  return `
以下は @${p.accountUsername} の${analysisLabel}データです。${analysisLabel}評価を行ってください。

【分析期間】${p.since} ～ ${p.until}

【サマリー】
${JSON.stringify(p.weeklySummary, null, 2)}

【サービスKPI設定】
${p.serviceKpiPromptBlock}

【従来システムのKPI進捗（参考・kpi_progress がある場合）】
${kpiLines.length > 0 ? kpiLines.join('\n') : '（データなし）'}

【パフォーマンス上位投稿】
${p.topPosts.slice(0, 5).map((row, i) => {
    const reach = row.insights.reach
    const ti = row.insights.total_interactions
    const eg =
      reach && reach > 0 && ti != null ? ((ti / reach) * 100).toFixed(1) : null
    return `${i + 1}. ${row.post.posted_at} - リーチ: ${row.insights.reach}, EG率: ${eg != null ? `${eg}%` : '—'}`
  }).join('\n')}
`
}

export function buildAccountReportSystemPrompt(p: AccountReportPromptPayload): string {
  return buildSystemPrompt(p.promptText, p.accountStrategy)
}

/** 投稿ごとに最新 snapshot のインサイトを集約（posts API と同ロジック） */
function foldLatestInsights(
  rows: Array<{ metric_code: string; value: number | null; snapshot_at: string }>
): Record<string, number | null> {
  const newestByMetric: Record<string, { value: number | null; snapshot_at: string }> = {}
  for (const ins of rows) {
    const prev = newestByMetric[ins.metric_code]
    if (!prev || ins.snapshot_at > prev.snapshot_at) {
      newestByMetric[ins.metric_code] = { value: ins.value, snapshot_at: ins.snapshot_at }
    }
  }
  const latest: Record<string, number | null> = {}
  for (const [code, row] of Object.entries(newestByMetric)) {
    latest[code] = row.value
  }
  return latest
}

export async function loadAccountReportPayload(
  supabase: SupabaseClient,
  accountId: string,
  analysisType: AccountReportAnalysisType,
  periodStart?: string,
  periodEnd?: string,
  options?: { prioritizeServiceKpis?: boolean },
): Promise<AccountReportPromptPayload> {
  const prioritizeServiceKpis = options?.prioritizeServiceKpis !== false
  const until = periodEnd ?? new Date().toISOString().slice(0, 10)
  const since =
    periodStart ??
    new Date(
      Date.now() -
        (analysisType === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000
    )
      .toISOString()
      .slice(0, 10)

  const { data: account } = await supabase
    .from('ig_accounts')
    .select('username')
    .eq('id', accountId)
    .single()

  const promptType = analysisType === 'weekly' ? 'account_weekly' : 'account_monthly'
  const { data: promptSetting } = await supabase
    .from('analysis_prompt_settings')
    .select('prompt_text')
    .eq('prompt_type', promptType)
    .eq('is_active', true)
    .single()

  const { data: strategySetting } = await supabase
    .from('account_strategy_settings')
    .select('strategy_text')
    .eq('account_id', accountId)
    .single()

  const { data: kpiProgress } = await supabase
    .from('kpi_progress')
    .select('*')
    .eq('account_id', accountId)
    .order('evaluated_at', { ascending: false })
    .limit(10)

  const { data: kpiMasters } = await supabase.from('kpi_master').select('*')

  const progressRows = kpiProgress ?? []
  const resultIds = progressRows
    .map((p) => p.kpi_result_id)
    .filter((id): id is string => Boolean(id))

  const kpiResultKpiIds = new Map<string, string | null>()
  if (resultIds.length > 0) {
    const { data: kpiResults } = await supabase
      .from('kpi_result')
      .select('id, kpi_id')
      .in('id', resultIds)
    for (const r of kpiResults ?? []) {
      kpiResultKpiIds.set(r.id, r.kpi_id)
    }
  }

  const { data: accountInsights } = await supabase
    .from('ig_account_insight_fact')
    .select('metric_code, value_date, value')
    .eq('account_id', accountId)
    .gte('value_date', since)
    .lte('value_date', until)

  const weeklySummary: Record<string, unknown> = {}
  for (const row of accountInsights ?? []) {
    if (!weeklySummary[row.metric_code]) weeklySummary[row.metric_code] = []
    ;(weeklySummary[row.metric_code] as unknown[]).push({
      date: row.value_date,
      value: row.value,
    })
  }

  const { data: topMediaRows } = await supabase
    .from('ig_media')
    .select(`
      *,
      ig_media_insight_fact(metric_code, value, snapshot_at)
    `)
    .eq('account_id', accountId)
    .gte('posted_at', since)
    .lte('posted_at', until)
    .eq('is_deleted', false)
    .order('posted_at', { ascending: false })
    .limit(10)

  const topPosts = (topMediaRows ?? []).map((row) => {
    const raw = row as IgMedia & {
      ig_media_insight_fact?: Array<{
        metric_code: string
        value: number | null
        snapshot_at: string
      }>
    }
    const { ig_media_insight_fact: facts, ...post } = raw
    const insights = foldLatestInsights(facts ?? [])
    return { post: post as IgMedia, insights }
  })

  const serviceKpiPromptBlock = await buildInstagramServiceKpiPromptBlock(
    supabase,
    accountId,
    prioritizeServiceKpis,
  )

  return {
    accountUsername: account?.username ?? 'unknown',
    since,
    until,
    analysisType,
    weeklySummary,
    serviceKpiPromptBlock,
    kpiProgress: progressRows,
    kpiMasters: kpiMasters ?? [],
    kpiResultKpiIds,
    topPosts,
    promptText: promptSetting?.prompt_text ?? '',
    accountStrategy: strategySetting?.strategy_text ?? '',
  }
}
