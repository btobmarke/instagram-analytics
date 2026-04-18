export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { anthropicLanguageModel } from '@/lib/ai/anthropic-model'
import { getAiModelIdForServiceId } from '@/lib/ai/resolve-ai-model'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import { proposalOutlineSchema, type ProposalOutline } from '@/lib/instagram/proposal-schemas'

const DOC_SYSTEM = `あなたはInstagramマーケティングの提案資料を執筆するプロです。
クライアントがそのままプレゼンや送付に使えるよう、丁寧な日本語でMarkdown本文を書いてください。
- 見出しは # ## ### を使い、構成案の章に対応させる
- 数値は要約に基づき、ないものは推測と明記しない
- トーンは敬体（です・ます）で統一`

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
    refinementNotes?: string
    since?: string
    until?: string
  }

  const parsedOutline = proposalOutlineSchema.safeParse(body.outline)
  if (!parsedOutline.success || !body.digest?.trim()) {
    return NextResponse.json(
      { success: false, error: 'outline と digest が必要です' },
      { status: 400 },
    )
  }

  const periodLine =
    body.since && body.until ? `分析期間: ${body.since} ～ ${body.until}` : '分析期間: （画面で指定）'

  const userPrompt = `
${periodLine}

【データ要約】
${body.digest.trim()}

【確定した構成案（JSON）】
${JSON.stringify(parsedOutline.data, null, 2)}

${body.refinementNotes?.trim() ? `【追加の指示・トーン】\n${body.refinementNotes.trim()}` : ''}

---

上記に基づき、提案資料の本文を **Markdown のみ** で出力してください。前置きや後書きの説明は不要です。`

  const modelId = await getAiModelIdForServiceId(supabase, serviceId)
  const model = anthropicLanguageModel(modelId)

  const { text } = await generateText({
    model,
    system: DOC_SYSTEM,
    prompt: userPrompt,
    maxOutputTokens: 8000,
  })

  return NextResponse.json({
    success: true,
    data: {
      markdown: text.trim(),
    },
  })
}
