export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { anthropicLanguageModel } from '@/lib/ai/anthropic-model'
import { getAiModelIdForServiceId } from '@/lib/ai/resolve-ai-model'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import {
  buildInstagramProposalDigest,
  resolveProposalDateRange,
  type ProposalPeriodPreset,
} from '@/lib/instagram/proposal-context'
import { parseProposalOutlineJson } from '@/lib/instagram/proposal-schemas'

const OUTLINE_SYSTEM = `あなたはInstagram運用の提案資料構成を設計するアシスタントです。
与えられた「データ要約」のみに基づき、クライアント向け提案資料の章立て（構成案）をJSONで返してください。
- 日本語のタイトル・見出しを使う
- 章は3〜10個。論理的な順序（現状把握→示唆→提案→次のアクションなど）にする
- 出力はJSONのみ。説明文やMarkdownコードフェンスは付けない。`

function outlineUserPrompt(digest: string): string {
  return `以下は対象期間のInstagramデータ要約です。

${digest}

---

次のJSONスキーマに**厳密に従って**出力してください（追加キーは禁止）:
${JSON.stringify(
  {
    document_title: 'string',
    audience: 'string（任意・誰向けの資料か）',
    sections: [
      {
        id: '一意の短い英数字',
        title: '章タイトル',
        purpose: 'この章の目的（任意）',
        key_points: ['箇条書きの要点（任意・最大10個）'],
      },
    ],
  },
  null,
  2,
)}`
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
  const accountId = resolved.accountId

  const body = (await request.json().catch(() => ({}))) as {
    periodPreset?: ProposalPeriodPreset
    periodStart?: string
    periodEnd?: string
  }

  const preset = body.periodPreset ?? '30d'
  if (preset === 'custom' && (!body.periodStart?.trim() || !body.periodEnd?.trim())) {
    return NextResponse.json(
      { success: false, error: '日付指定では開始日・終了日が必要です' },
      { status: 400 },
    )
  }
  const range = resolveProposalDateRange(
    preset,
    body.periodStart,
    body.periodEnd,
  )

  if (range.since > range.until) {
    return NextResponse.json({ success: false, error: '開始日は終了日以前である必要があります' }, { status: 400 })
  }

  let digest: string
  try {
    digest = await buildInstagramProposalDigest(supabase, accountId, range)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'データ取得に失敗しました'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }

  const modelId = await getAiModelIdForServiceId(supabase, serviceId)
  const model = anthropicLanguageModel(modelId)

  async function runOnce(extraHint?: string): Promise<string> {
    const hint = extraHint ? `\n\n前回の出力はスキーマ不正でした。修正指示: ${extraHint}\n` : ''
    const { text } = await generateText({
      model,
      system: OUTLINE_SYSTEM,
      prompt: outlineUserPrompt(digest) + hint,
      maxOutputTokens: 2500,
    })
    return text
  }

  let raw = await runOnce()
  let parsed = parseProposalOutlineJson(raw)
  if (!parsed.ok) {
    raw = await runOnce(parsed.error)
    parsed = parseProposalOutlineJson(raw)
  }

  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: `構成案の解析に失敗しました: ${parsed.error}` },
      { status: 422 },
    )
  }

  return NextResponse.json({
    success: true,
    data: {
      outline: parsed.data,
      digest,
      since: range.since,
      until: range.until,
    },
  })
}
