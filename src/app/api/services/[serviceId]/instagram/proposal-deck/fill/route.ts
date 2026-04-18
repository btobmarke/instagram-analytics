export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { anthropicLanguageModel } from '@/lib/ai/anthropic-model'
import { getAiModelIdForServiceId } from '@/lib/ai/resolve-ai-model'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import { proposalOutlineSchema, type ProposalOutline } from '@/lib/instagram/proposal-schemas'
import { buildDeckPagePlans } from '@/lib/instagram/proposal-deck/types'
import { parseProposalDeckJson } from '@/lib/instagram/proposal-deck/schema'

const SYSTEM = `あなたはInstagram運用の提案資料を、PowerPoint用の構造化データに落とし込むアシスタントです。
- 出力は **JSON のみ**（説明文・Markdownフェンス禁止）
- データ要約にない数値や事実は捏造しない
- 日本語・敬体の文体で本文・箇条書きを書く
- slides の順序と pageKey・sectionId は指示どおり厳守`

function userPrompt(
  outline: ProposalOutline,
  digest: string,
  since: string,
  until: string,
  plans: ReturnType<typeof buildDeckPagePlans>,
): string {
  return `【分析期間】${since} ～ ${until}

【データ要約】
${digest}

【確定した構成案】
${JSON.stringify(outline, null, 2)}

【必須のスライド構成（この順・この pageKey・section の対応を厳守）】
${JSON.stringify(plans, null, 2)}

---

次の JSON スキーマに**厳密に従って**出力してください。

{
  "version": 1,
  "documentTitle": "string（表紙タイトルに相当。outline.document_title をベースに可）",
  "slides": [
    {
      "pageKey": "cover",
      "slots": { "title": "string", "subtitle": "string（期間・読者・サービス名など短く）" }
    },
    {
      "pageKey": "kpi",
      "slots": {
        "title": "string（例: 主要指標サマリー）",
        "metric_rows": [ { "label": "string", "value": "string（数値は要約の範囲内のみ）" } ]
      }
    },
    ... 構成案の各章について、順に 1 枚ずつ:
    {
      "pageKey": "section",
      "sectionId": "（outline.sections[].id と一致させる）",
      "slots": {
        "title": "string",
        "body": "string（その章の説明文・2〜6文程度）",
        "bullets": ["箇条書き1", "箇条書き2", ...]
      }
    }
  ]
}

- slides の枚数は ${plans.length} 枚ちょうど（cover 1 + kpi 1 + 章 ${outline.sections.length}）
- section スライドは outline.sections と同じ順で、sectionId を一致させる`
}

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
    since?: string
    until?: string
  }

  const parsedOutline = proposalOutlineSchema.safeParse(body.outline)
  if (!parsedOutline.success || !body.digest?.trim() || !body.since?.trim() || !body.until?.trim()) {
    return NextResponse.json(
      { success: false, error: 'outline・digest・since・until が必要です' },
      { status: 400 },
    )
  }

  const plans = buildDeckPagePlans(parsedOutline.data)
  const modelId = await getAiModelIdForServiceId(supabase, serviceId)
  const model = anthropicLanguageModel(modelId)

  async function runOnce(extra?: string): Promise<string> {
    const hint = extra ? `\n\n前回の出力は不正でした。修正: ${extra}\n` : ''
    const { text } = await generateText({
      model,
      system: SYSTEM,
      prompt: userPrompt(parsedOutline.data, body.digest!.trim(), body.since!, body.until!) + hint,
      maxOutputTokens: 12000,
    })
    return text
  }

  let raw = await runOnce()
  let parsed = parseProposalDeckJson(raw)
  if (!parsed.ok) {
    raw = await runOnce(parsed.error)
    parsed = parseProposalDeckJson(raw)
  }

  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: `構造化データの解析に失敗しました: ${parsed.error}` },
      { status: 422 },
    )
  }

  return NextResponse.json({
    success: true,
    data: {
      deck: parsed.data,
      pagePlans: plans,
    },
  })
}
