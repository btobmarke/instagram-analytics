export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { streamText } from 'ai'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { anthropicLanguageModel } from '@/lib/ai/anthropic-model'
import {
  buildAccountReportSystemPrompt,
  buildAccountReportUserMessage,
  loadAccountReportPayload,
  type AccountReportAnalysisType,
} from '@/lib/ai/account-report-data'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import { getAiModelIdForServiceId } from '@/lib/ai/resolve-ai-model'

// GET /api/services/:serviceId/ai/report?type=account_weekly — 過去の AI 分析一覧
export async function GET(
  request: Request,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const resolved = await resolveInstagramAccountIdForService(supabase, serviceId)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  const { searchParams } = new URL(request.url)
  const analysisType = searchParams.get('type')

  let query = supabase
    .from('ai_analysis_results')
    .select('*')
    .eq('account_id', resolved.accountId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (analysisType) query = query.eq('analysis_type', analysisType)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST — 週次/月次レポートをストリーミング生成（useCompletion / data プロトコル）
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const analysisType: AccountReportAnalysisType =
    body.analysisType === 'monthly' ? 'monthly' : 'weekly'
  const periodStart = typeof body.periodStart === 'string' ? body.periodStart : undefined
  const periodEnd = typeof body.periodEnd === 'string' ? body.periodEnd : undefined

  const resolved = await resolveInstagramAccountIdForService(supabase, serviceId)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const accountId = resolved.accountId
  const modelId = await getAiModelIdForServiceId(supabase, serviceId)
  const languageModel = anthropicLanguageModel(modelId)

  const payload = await loadAccountReportPayload(
    supabase,
    accountId,
    analysisType,
    periodStart,
    periodEnd
  )

  const system = buildAccountReportSystemPrompt(payload)
  const prompt = buildAccountReportUserMessage(payload)
  const analysisTypeDb =
    analysisType === 'weekly' ? 'account_weekly' : 'account_monthly'

  const admin = createSupabaseAdminClient()

  const result = streamText({
    model: languageModel,
    system,
    prompt,
    maxOutputTokens: 3000,
    onFinish: async (event) => {
      const text = event.text
      if (!text?.trim()) return

      await admin.from('ai_analysis_results').insert({
        account_id: accountId,
        analysis_type: analysisTypeDb,
        analysis_result: text,
        model_used: modelId,
        target_period_start: payload.since,
        target_period_end: payload.until,
        triggered_by: 'user',
        tokens_used: event.totalUsage?.totalTokens ?? null,
      })
    },
  })

  return result.toUIMessageStreamResponse()
}
