export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { analyzeAccount } from '@/lib/claude/client'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { getAiModelIdForAccountId } from '@/lib/ai/resolve-ai-model'
import { buildInstagramServiceKpiPromptBlock } from '@/lib/ai/instagram-service-kpis-for-prompt'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

// POST /api/batch/ai-analysis — 週次AI分析バッチ
export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()
  let processed = 0

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'weekly_ai_analysis',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  try {
    const { data: accounts } = await admin.from('ig_accounts').select('id, username').eq('status', 'active')
    const { data: kpiMasters } = await admin.from('kpi_master').select('*')

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)

    for (const account of (accounts ?? [])) {
      try {
        const modelId = await getAiModelIdForAccountId(admin, account.id)

        const { data: promptSetting } = await admin
          .from('analysis_prompt_settings')
          .select('prompt_text')
          .eq('prompt_type', 'account_weekly')
          .eq('is_active', true)
          .single()

        const { data: strategySetting } = await admin
          .from('account_strategy_settings')
          .select('strategy_text')
          .eq('account_id', account.id)
          .single()

        const { data: kpiProgress } = await admin
          .from('kpi_progress')
          .select('*')
          .eq('account_id', account.id)
          .order('evaluated_at', { ascending: false })
          .limit(10)

        const { data: accountInsights } = await admin
          .from('ig_account_insight_fact')
          .select('metric_code, value_date, value')
          .eq('account_id', account.id)
          .gte('value_date', weekAgo)
          .lte('value_date', today)

        const summary: Record<string, unknown> = {}
        for (const row of (accountInsights ?? [])) {
          if (!summary[row.metric_code]) summary[row.metric_code] = []
          ;(summary[row.metric_code] as unknown[]).push({ date: row.value_date, value: row.value })
        }

        const serviceKpiPromptBlock = await buildInstagramServiceKpiPromptBlock(admin, account.id, true)

        const result = await analyzeAccount({
          accountUsername: account.username,
          period: { start: weekAgo, end: today },
          analysisType: 'weekly',
          weeklySummary: summary,
          serviceKpiPromptBlock,
          kpiProgress: kpiProgress ?? [],
          kpiMasters: kpiMasters ?? [],
          topPosts: [],
          promptText: promptSetting?.prompt_text ?? '',
          accountStrategy: strategySetting?.strategy_text ?? '',
          modelId,
        })

        await admin.from('ai_analysis_results').insert({
          account_id: account.id,
          analysis_type: 'account_weekly',
          analysis_result: result,
          model_used: modelId,
          target_period_start: weekAgo,
          target_period_end: today,
          triggered_by: 'batch_weekly',
        })
        processed++
      } catch { /* continue other accounts */ }
    }

    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'success',
        records_processed: processed,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }

    await notifyBatchSuccess({
      jobName: 'weekly_ai_analysis',
      processed,
      executedAt: startedAt,
      lines: ['種別: account_weekly'],
    })

    return NextResponse.json({ success: true, processed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'weekly_ai_analysis',
      processed: 0,
      errorCount: 1,
      errors: [{ error: message }],
      executedAt: startedAt,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel Cron は GET で呼び出す
export async function GET(request: Request) {
  return POST(request)
}
