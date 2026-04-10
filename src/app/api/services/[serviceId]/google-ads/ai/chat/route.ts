export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { convertToModelMessages, streamText, type UIMessage } from 'ai'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { anthropicLanguageModel } from '@/lib/ai/anthropic-model'
import { getAiModelIdForServiceId } from '@/lib/ai/resolve-ai-model'
import { buildGoogleAdsChatSystemPrompt, loadGoogleAdsChatContext } from '@/lib/ai/google-ads-chat-context'

// POST /api/services/:serviceId/google-ads/ai/chat — AIチャット（ストリーミング）
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

  const body = (await request.json().catch(() => ({}))) as { messages?: UIMessage[] }
  const messages = Array.isArray(body.messages) ? body.messages : []

  const modelId = await getAiModelIdForServiceId(supabase, serviceId)
  const languageModel = anthropicLanguageModel(modelId)

  const ctx = await loadGoogleAdsChatContext({ supabase, serviceId })
  const system = buildGoogleAdsChatSystemPrompt(ctx)

  const result = streamText({
    model: languageModel,
    system,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 1500,
  })

  return result.toUIMessageStreamResponse()
}

