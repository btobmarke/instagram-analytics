export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { analyzeAccount } from '@/lib/claude/client'

// POST /api/analytics/ai — アカウント週次/月次AI分析
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { accountId, analysisType = 'weekly', periodStart, periodEnd } = body

  if (!accountId) return NextResponse.json({ error: 'accountId が必要です' }, { status: 400 })

  const until = periodEnd ?? new Date().toISOString().slice(0, 10)
  const since = periodStart ?? new Date(Date.now() - (analysisType === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // アカウント情報
  const { data: account } = await supabase.from('ig_accounts').select('username').eq('id', accountId).single()

  // プロンプト設定
  const promptType = analysisType === 'weekly' ? 'account_weekly' : 'account_monthly'
  const { data: promptSetting } = await supabase
    .from('analysis_prompt_settings')
    .select('prompt_text')
    .eq('prompt_type', promptType)
    .eq('is_active', true)
    .single()

  // 戦略設定
  const { data: strategySetting } = await supabase
    .from('account_strategy_settings')
    .select('strategy_text')
    .eq('account_id', accountId)
    .single()

  // KPI進捗
  const { data: kpiProgress } = await supabase
    .from('kpi_progress')
    .select('*')
    .eq('account_id', accountId)
    .order('evaluated_at', { ascending: false })
    .limit(10)

  const { data: kpiMasters } = await supabase.from('kpi_master').select('*')

  // サマリーデータ
  const { data: accountInsights } = await supabase
    .from('ig_account_insight_fact')
    .select('metric_code, value_date, value')
    .eq('account_id', accountId)
    .gte('value_date', since)
    .lte('value_date', until)

  const summary: Record<string, unknown> = {}
  for (const row of (accountInsights ?? [])) {
    if (!summary[row.metric_code]) summary[row.metric_code] = []
    ;(summary[row.metric_code] as unknown[]).push({ date: row.value_date, value: row.value })
  }

  // トップ投稿
  const { data: topMediaRows } = await supabase
    .from('ig_media')
    .select('*')
    .eq('account_id', accountId)
    .gte('posted_at', since)
    .lte('posted_at', until)
    .eq('is_deleted', false)
    .order('posted_at', { ascending: false })
    .limit(10)

  const topPosts = (topMediaRows ?? []).map(post => ({ post, insights: {} as Record<string, number | null> }))

  const result = await analyzeAccount({
    accountUsername: account?.username ?? 'unknown',
    period: { start: since, end: until },
    analysisType: analysisType as 'weekly' | 'monthly',
    weeklySummary: summary,
    kpiProgress: kpiProgress ?? [],
    kpiMasters: kpiMasters ?? [],
    topPosts,
    promptText: promptSetting?.prompt_text ?? '',
    accountStrategy: strategySetting?.strategy_text ?? '',
  })

  // 結果保存
  const admin = createSupabaseAdminClient()
  const { data: saved } = await admin.from('ai_analysis_results').insert({
    account_id: accountId,
    analysis_type: analysisType === 'weekly' ? 'account_weekly' : 'account_monthly',
    analysis_result: result,
    model_used: 'claude-sonnet-4-6',
    target_period_start: since,
    target_period_end: until,
    triggered_by: 'user',
  }).select().single()

  return NextResponse.json({ data: saved })
}

// GET /api/analytics/ai?account=<id>&type=account_weekly — 過去のAI分析一覧
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account')
  const analysisType = searchParams.get('type')

  if (!accountId) return NextResponse.json({ error: 'account パラメータが必要です' }, { status: 400 })

  let query = supabase
    .from('ai_analysis_results')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (analysisType) query = query.eq('analysis_type', analysisType)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
