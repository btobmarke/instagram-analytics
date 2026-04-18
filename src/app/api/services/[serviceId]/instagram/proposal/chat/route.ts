export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { anthropicLanguageModel } from '@/lib/ai/anthropic-model'
import { getAiModelIdForServiceId } from '@/lib/ai/resolve-ai-model'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import { proposalOutlineSchema, type ProposalOutline } from '@/lib/instagram/proposal-schemas'

const CHAT_SYSTEM = `あなたはInstagram運用の提案資料づくりを手伝うアシスタントです。
ユーザーは構成案とデータ要約を見ながら、章立て・トーン・強調点について相談しています。
簡潔に、実務的に答えてください。`

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const resolved = await resolveInstagramAccountIdForService(supabase, serviceId)
  if ('error' in resolved) {
    return NextResponse.json({ success: false, error: resolved.error }, { status: resolved.status })
  }

  const body = (await request.json().catch(() => ({}))) as {
    outline?: ProposalOutline
    digest?: string
    messages?: Array<{ role: string; content: string }>
  }

  const o = proposalOutlineSchema.safeParse(body.outline)
  if (!o.success || !body.digest?.trim()) {
    return NextResponse.json({ success: false, error: 'outline と digest が必要です' }, { status: 400 })
  }

  const msgs = Array.isArray(body.messages) ? body.messages : []
  const last = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-12)
  if (last.length === 0 || last[last.length - 1]?.role !== 'user') {
    return NextResponse.json({ success: false, error: 'ユーザーのメッセージが必要です' }, { status: 400 })
  }

  const conversation = last
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.content}`)
    .join('\n\n')

  const prompt = `
【データ要約（抜粋・参考）】
${body.digest.trim().slice(0, 12000)}

【確定構成案】
${JSON.stringify(o.data, null, 2)}

【直近の会話】
${conversation}

上記に基づき、最後のユーザーの発言に返答してください。`

  const modelId = await getAiModelIdForServiceId(supabase, serviceId)
  const model = anthropicLanguageModel(modelId)

  const { text } = await generateText({
    model,
    system: CHAT_SYSTEM,
    prompt,
    maxOutputTokens: 2000,
  })

  return NextResponse.json({
    success: true,
    data: {
      reply: text.trim(),
    },
  })
}
