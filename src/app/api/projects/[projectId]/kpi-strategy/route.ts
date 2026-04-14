/**
 * POST /api/projects/[projectId]/kpi-strategy
 *   5 種類の配分戦略を計算して保存する
 *
 * GET /api/projects/[projectId]/kpi-strategy
 *   保存済み戦略一覧取得（weightVersionId で絞り込み可能）
 *
 * Body (POST):
 *   {
 *     weightVersionId: string
 *     name:            string          // 戦略プラン名
 *     strategyType:    'proportional' | 'equal_growth' | 'efficiency_max' | 'manual' | 'elasticity'
 *     yTarget:         number          // 親ノードの目標値
 *     yCurrent:        number          // 現在値（基準）
 *     xCurrents:       Record<string, number>  // X ごとの現在値 {ref: value}
 *     manualInputs?:   Record<string, number>  // 手動配分の場合のデルタ指定
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const PostSchema = z.object({
  weightVersionId: z.string().uuid(),
  name:            z.string().min(1).max(100),
  strategyType:    z.enum(['proportional', 'equal_growth', 'efficiency_max', 'manual', 'elasticity']),
  yTarget:         z.number(),
  yCurrent:        z.number(),
  xCurrents:       z.record(z.string(), z.number()),
  manualInputs:    z.record(z.string(), z.number()).optional(),
})

// ── 配分戦略ロジック ──────────────────────────────────────────────────────────

interface Coefficient {
  label: string
  coef:  number
  vif?:  number | null
}

interface AllocationResult {
  ref:       string
  label:     string
  current:   number
  target:    number
  delta:     number
  deltaPct:  number
}

/**
 * 戦略①: 比例貢献（Proportional Contribution）
 * 各 X の貢献度（β_i * X_i）に比例して Δy を配分する
 */
function proportionalAllocation(
  yDelta: number,
  intercept: number,
  coefficients: Coefficient[],
  xCurrents: Record<string, number>,
): AllocationResult[] {
  const contributions = coefficients.map(c => ({
    ref:         c.label,
    label:       c.label,
    coef:        c.coef,
    current:     xCurrents[c.label] ?? 0,
    contribution: Math.abs(c.coef * (xCurrents[c.label] ?? 0)),
  }))

  const totalContrib = contributions.reduce((s, c) => s + c.contribution, 0)

  return contributions.map(c => {
    const share = totalContrib > 0 ? c.contribution / totalContrib : 1 / contributions.length
    // Δy = β_i * ΔX_i  → ΔX_i = (share * Δy) / β_i
    const deltaX = c.coef !== 0 ? (share * yDelta) / c.coef : 0
    const target = c.current + deltaX
    return {
      ref:      c.ref,
      label:    c.label,
      current:  c.current,
      target:   Math.round(target * 100) / 100,
      delta:    Math.round(deltaX * 100) / 100,
      deltaPct: c.current !== 0 ? Math.round((deltaX / c.current) * 10000) / 100 : 0,
    }
  })
}

/**
 * 戦略②: 均等成長率（Equal Growth Rate）
 * 全 X を同じ成長率で引き上げる: X_i_target = X_i_current * (1 + r)
 * β1*X1*r + β2*X2*r + ... = Δy  → r = Δy / Σ(β_i * X_i)
 */
function equalGrowthAllocation(
  yDelta: number,
  coefficients: Coefficient[],
  xCurrents: Record<string, number>,
): AllocationResult[] {
  const weightedSum = coefficients.reduce((s, c) => s + c.coef * (xCurrents[c.label] ?? 0), 0)
  const r = weightedSum !== 0 ? yDelta / weightedSum : 0

  return coefficients.map(c => {
    const current = xCurrents[c.label] ?? 0
    const deltaX  = current * r
    const target  = current + deltaX
    return {
      ref:      c.label,
      label:    c.label,
      current,
      target:   Math.round(target * 100) / 100,
      delta:    Math.round(deltaX * 100) / 100,
      deltaPct: Math.round(r * 10000) / 100,
    }
  })
}

/**
 * 戦略③: 効率最大化（Efficiency Maximization）
 * 最も係数（β）が大きい変数だけを引き上げる
 */
function efficiencyMaxAllocation(
  yDelta: number,
  coefficients: Coefficient[],
  xCurrents: Record<string, number>,
): AllocationResult[] {
  const sorted = [...coefficients].sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
  const maxCoef = sorted[0]

  return coefficients.map(c => {
    if (c.label === maxCoef.label && c.coef !== 0) {
      const deltaX = yDelta / c.coef
      const current = xCurrents[c.label] ?? 0
      const target  = current + deltaX
      return {
        ref:      c.label,
        label:    c.label,
        current,
        target:   Math.round(target * 100) / 100,
        delta:    Math.round(deltaX * 100) / 100,
        deltaPct: current !== 0 ? Math.round((deltaX / current) * 10000) / 100 : 0,
      }
    }
    const current = xCurrents[c.label] ?? 0
    return { ref: c.label, label: c.label, current, target: current, delta: 0, deltaPct: 0 }
  })
}

/**
 * 戦略④: 手動配分（Manual Input）
 * ユーザーが各 X のデルタを直接入力し、達成可能 Y を計算して表示
 */
function manualAllocation(
  coefficients: Coefficient[],
  xCurrents: Record<string, number>,
  manualInputs: Record<string, number>,
): AllocationResult[] {
  return coefficients.map(c => {
    const current = xCurrents[c.label] ?? 0
    const deltaX  = manualInputs[c.label] ?? 0
    const target  = current + deltaX
    return {
      ref:      c.label,
      label:    c.label,
      current,
      target:   Math.round(target * 100) / 100,
      delta:    Math.round(deltaX * 100) / 100,
      deltaPct: current !== 0 ? Math.round((deltaX / current) * 10000) / 100 : 0,
    }
  })
}

/**
 * 戦略⑤: 弾力性表示（Elasticity Display）
 * 各 X を 1% 変化させたときの Y の変化率（弾力性）を計算・表示
 * ΔX_i = X_i * 0.01 → ΔY_i = β_i * ΔX_i
 * 弾力性 = (ΔY/Y) / (ΔX/X) = β_i * X_i / Y
 */
function elasticityDisplay(
  yTarget: number,  // Y の現在値（参照用）
  coefficients: Coefficient[],
  xCurrents: Record<string, number>,
): AllocationResult[] {
  return coefficients.map(c => {
    const current   = xCurrents[c.label] ?? 0
    const elasticity = yTarget !== 0 ? (c.coef * current) / yTarget : 0
    return {
      ref:      c.label,
      label:    c.label,
      current,
      target:   current,  // 弾力性表示なので目標は変えない
      delta:    elasticity,  // delta フィールドを弾力性として流用
      deltaPct: Math.round(elasticity * 10000) / 100,  // % 表示
    }
  })
}

// ── ハンドラ ──────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { weightVersionId, name, strategyType, yTarget, yCurrent, xCurrents, manualInputs } = parsed.data

  // 重みバージョン取得
  const { data: weightVer, error: wErr } = await supabase
    .from('kpi_weight_versions')
    .select('*')
    .eq('id', weightVersionId)
    .eq('project_id', projectId)
    .single()

  if (wErr || !weightVer) {
    return NextResponse.json({ success: false, error: '重みバージョンが見つかりません' }, { status: 404 })
  }

  const coefficients = weightVer.coefficients as Coefficient[]
  const intercept    = weightVer.intercept as number
  const yDelta       = yTarget - yCurrent

  // 戦略計算
  let allocations: AllocationResult[] = []

  switch (strategyType) {
    case 'proportional':
      allocations = proportionalAllocation(yDelta, intercept, coefficients, xCurrents)
      break
    case 'equal_growth':
      allocations = equalGrowthAllocation(yDelta, coefficients, xCurrents)
      break
    case 'efficiency_max':
      allocations = efficiencyMaxAllocation(yDelta, coefficients, xCurrents)
      break
    case 'manual':
      allocations = manualAllocation(coefficients, xCurrents, manualInputs ?? {})
      break
    case 'elasticity':
      allocations = elasticityDisplay(yCurrent, coefficients, xCurrents)
      break
  }

  // 手動配分の場合、達成可能 Y を計算して追加情報として付与
  let expectedY: number | null = null
  if (strategyType === 'manual') {
    expectedY = intercept + allocations.reduce((s, a) => {
      const coef = coefficients.find(c => c.label === a.ref)?.coef ?? 0
      return s + coef * a.target
    }, 0)
    expectedY = Math.round(expectedY * 100) / 100
  }

  // DB 保存
  const { data: saved, error: saveErr } = await supabase
    .from('kpi_strategy_plans')
    .insert({
      project_id:        projectId,
      weight_version_id: weightVersionId,
      name,
      strategy_type:     strategyType,
      y_target:          yTarget,
      y_current:         yCurrent,
      allocations,
      manual_inputs:     manualInputs ?? {},
    })
    .select()
    .single()

  if (saveErr) {
    return NextResponse.json({ success: false, error: saveErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: {
      ...saved,
      expectedY,
    },
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const weightVersionId = searchParams.get('weightVersionId')

  let query = supabase
    .from('kpi_strategy_plans')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (weightVersionId) query = query.eq('weight_version_id', weightVersionId)

  const { data, error } = await query

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data: data ?? [] })
}
