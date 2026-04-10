export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { streamText } from 'ai'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { anthropicLanguageModel } from '@/lib/ai/anthropic-model'
import { getAiModelIdForServiceId } from '@/lib/ai/resolve-ai-model'
import {
  buildGoogleAdsReportSystemPrompt,
  buildGoogleAdsReportUserMessage,
  loadGoogleAdsReportPayload,
  type GoogleAdsReportAnalysisType,
} from '@/lib/ai/google-ads-report-data'

// GET /api/services/:serviceId/google-ads/ai/report?type=google_ads_weekly — 過去の AI 分析一覧（サービス単位）
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

  const { searchParams } = new URL(request.url)
  const analysisType = searchParams.get('type')

  let query = supabase
    .from('ai_service_analysis_results')
    .select('*')
    .eq('service_id', serviceId)
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
  const analysisType: GoogleAdsReportAnalysisType =
    body.analysisType === 'monthly' ? 'monthly' : 'weekly'
  const periodStart = typeof body.periodStart === 'string' ? body.periodStart : undefined
  const periodEnd = typeof body.periodEnd === 'string' ? body.periodEnd : undefined

  const modelId = await getAiModelIdForServiceId(supabase, serviceId)
  const languageModel = anthropicLanguageModel(modelId)

  const payload = await loadGoogleAdsReportPayload({
    supabase,
    serviceId,
    analysisType,
    periodStart,
    periodEnd,
  })

  const system = buildGoogleAdsReportSystemPrompt()
  const prompt = buildGoogleAdsReportUserMessage(payload)
  const analysisTypeDb = analysisType === 'weekly' ? 'google_ads_weekly' : 'google_ads_monthly'

  const admin = createSupabaseAdminClient()

  const result = streamText({
    model: languageModel,
    system,
    prompt,
    maxOutputTokens: 3000,
    onFinish: async (event) => {
      const text = event.text
      if (!text?.trim()) return

      await admin.from('ai_service_analysis_results').insert({
        service_id: serviceId,
        service_type: 'google_ads',
        analysis_type: analysisTypeDb,
        analysis_result: text,
        model_used: modelId,
        target_period_start: payload.period.start,
        target_period_end: payload.period.end,
        triggered_by: 'user',
        tokens_used: event.totalUsage?.totalTokens ?? null,
      })
    },
  })

  return result.toUIMessageStreamResponse()
}

