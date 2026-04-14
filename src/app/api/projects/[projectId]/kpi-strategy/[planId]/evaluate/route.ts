/**
 * POST /api/projects/[projectId]/kpi-strategy/[planId]/evaluate
 *
 * 立てた戦略に対して、実績データをもとに AI 分析・評価を行う
 *
 * Body:
 *   {
 *     evalStart:  string   // 評価対象期間 YYYY-MM-DD
 *     evalEnd:    string
 *     actualY:    number   // 評価期間の Y 実績値
 *     actualXs:  Record<string, number>  // X ごとの実績値
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const BodySchema = z.object({
  evalStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evalEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  actualY:   z.number(),
  actualXs:  z.record(z.string(), z.number()),
})

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; planId: string }> },
) {
  const { projectId, planId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { evalStart, evalEnd, actualY, actualXs } = parsed.data

  // 戦略プラン取得
  const { data: plan, error: planErr } = await supabase
    .from('kpi_strategy_plans')
    .select('*, kpi_weight_versions(*)')
    .eq('id', planId)
    .eq('project_id', projectId)
    .single()

  if (planErr || !plan) {
    return NextResponse.json({ success: false, error: '戦略プランが見つかりません' }, { status: 404 })
  }

  const allocations = plan.allocations as {
    ref: string; label: string; current: number; target: number; delta: number; deltaPct: number
  }[]

  // Y の達成率
  const yAchievementRate = plan.y_current !== 0
    ? Math.round(((actualY - plan.y_current) / (plan.y_target - plan.y_current)) * 10000) / 100
    : 0

  // X ごとの達成率
  const xAchievements = allocations.map(a => {
    const actual  = actualXs[a.ref] ?? 0
    const delta   = actual - a.current
    const targetDelta = a.delta
    const ach = targetDelta !== 0
      ? Math.round((delta / targetDelta) * 10000) / 100
      : null
    return {
      ref:           a.ref,
      label:         a.label,
      current:       a.current,
      target:        a.target,
      actual,
      targetDelta,
      actualDelta:   delta,
      achievementRate: ach,
    }
  })

  // AI プロンプト構築
  const weightVer = plan.kpi_weight_versions as {
    target_ref: string; r2: number; ridge_lambda: number
  }
  const strategyLabels: Record<string, string> = {
    proportional:   '比例貢献戦略',
    equal_growth:   '均等成長率戦略',
    efficiency_max: '効率最大化戦略',
    manual:         '手動配分戦略',
    elasticity:     '弾力性表示',
  }

  const prompt = `
あなたは KPI 分析の専門家です。以下の戦略と実績を評価し、日本語で具体的なフィードバックを提供してください。

## 戦略情報
- 戦略名: ${plan.name}
- 戦略タイプ: ${strategyLabels[plan.strategy_type as string] ?? plan.strategy_type}
- 評価期間: ${evalStart} 〜 ${evalEnd}
- 回帰モデルの決定係数 R²: ${weightVer.r2} (1.0 に近いほど精度が高い)

## 目標 vs 実績 (Y: 目的変数)
- 基準値: ${plan.y_current}
- 目標値: ${plan.y_target} (+${plan.y_target - plan.y_current})
- 実績値: ${actualY} (+${actualY - plan.y_current})
- Y 達成率: ${yAchievementRate}%

## 説明変数ごとの目標 vs 実績
${xAchievements.map(x => `
- ${x.label}:
  基準: ${x.current}, 目標Δ: +${x.targetDelta}, 実績Δ: +${x.actualDelta}
  達成率: ${x.achievementRate != null ? x.achievementRate + '%' : '測定不能（目標変化なし）'}
`).join('')}

## 評価してほしい観点
1. Y（目的変数）の達成状況と主な要因
2. 各説明変数の貢献度と改善余地
3. 採用した戦略タイプの適切さ（この状況に対して最善だったか）
4. 次の戦略サイクルへの具体的な推奨アクション（3点以内）
5. 回帰モデルの信頼性に関するコメント（R² = ${weightVer.r2}）

簡潔かつ実用的に、箇条書きと短い段落を組み合わせて回答してください。
`.trim()

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2000,
    messages:   [{ role: 'user', content: prompt }],
  })

  const aiText = response.content[0].type === 'text' ? response.content[0].text : ''

  const evaluation = {
    yAchievementRate,
    xAchievements,
    aiComment: aiText,
    evalStart,
    evalEnd,
    actualY,
    actualXs,
    evaluatedAt: new Date().toISOString(),
  }

  // 戦略プランに評価結果を保存
  const { error: updateErr } = await supabase
    .from('kpi_strategy_plans')
    .update({
      ai_evaluation: evaluation,
      evaluated_at:  new Date().toISOString(),
      eval_start:    evalStart,
      eval_end:      evalEnd,
    })
    .eq('id', planId)

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: evaluation })
}
