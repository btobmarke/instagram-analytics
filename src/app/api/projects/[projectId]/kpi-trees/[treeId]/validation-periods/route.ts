/**
 * GET  /api/projects/[projectId]/kpi-trees/[treeId]/validation-periods
 *   — 検証期間一覧取得
 *
 * POST /api/projects/[projectId]/kpi-trees/[treeId]/validation-periods
 *   — 検証期間を登録し、endDate が過去なら即時 MAPE 評価を実行する
 *
 * POST body:
 *   {
 *     name:      string      // 検証期間の名称（例: "2024年Q1"）
 *     startDate: string      // YYYY-MM-DD
 *     endDate:   string      // YYYY-MM-DD
 *     timeUnit?: 'day'|'week'|'month'  // default: 'day'
 *   }
 *
 * Response (POST):
 *   {
 *     success: true,
 *     data: {
 *       period:   KpiValidationPeriod
 *       evaluated: boolean   // 即時評価を実施したか
 *     }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { buildWideTable } from '@/lib/analysis/regression'

const CreateSchema = z.object({
  name:      z.string().min(1).max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeUnit:  z.enum(['day', 'week', 'month']).default('day'),
})

type RouteParams = { params: Promise<{ projectId: string; treeId: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { projectId, treeId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { data, error } = await supabase
    .from('kpi_validation_periods')
    .select('*')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data: data ?? [] })
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { projectId, treeId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { name, startDate, endDate, timeUnit } = parsed.data

  if (startDate >= endDate) {
    return NextResponse.json(
      { success: false, error: 'startDate は endDate より前にしてください' },
      { status: 400 },
    )
  }

  // ── 1. 検証期間を登録 ────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const isPast = endDate < today

  const { data: period, error: insertErr } = await supabase
    .from('kpi_validation_periods')
    .insert({
      project_id:  projectId,
      kpi_tree_id: treeId,
      name,
      start_date:  startDate,
      end_date:    endDate,
      time_unit:   timeUnit,
      status:      isPast ? 'evaluating' : 'pending',
    })
    .select()
    .single()

  if (insertErr || !period) {
    return NextResponse.json({ success: false, error: insertErr?.message ?? '登録に失敗しました' }, { status: 500 })
  }

  const periodId = period.id as string

  // ── 2. 過去期間なら即時 MAPE 評価 ────────────────────────────────────────────
  if (!isPast) {
    return NextResponse.json({
      success: true,
      data: { period, evaluated: false },
    })
  }

  try {
    const mapeResults = await evaluateMape(supabase, projectId, treeId, startDate, endDate, timeUnit)

    const { data: updated } = await supabase
      .from('kpi_validation_periods')
      .update({
        status:       'completed',
        results:      mapeResults,
        evaluated_at: new Date().toISOString(),
      })
      .eq('id', periodId)
      .select()
      .single()

    return NextResponse.json({
      success: true,
      data: { period: updated ?? period, evaluated: true },
    })
  } catch (err) {
    console.error('[validation-periods] MAPE evaluation error:', err)
    await supabase
      .from('kpi_validation_periods')
      .update({ status: 'failed', error_message: '評価中にエラーが発生しました' })
      .eq('id', periodId)

    return NextResponse.json({
      success: true,
      data: { period, evaluated: false, warning: '評価に失敗しました。後ほど再試行してください。' },
    })
  }
}

// ── MAPE 評価ロジック ─────────────────────────────────────────────────────────

/**
 * 各プリセットの最新重みバージョンを使って検証期間の MAPE を計算する。
 */
async function evaluateMape(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createSupabaseServerClient>>,
  projectId: string,
  treeId: string,
  startDate: string,
  endDate: string,
  timeUnit: 'day' | 'week' | 'month',
): Promise<{
  presetResults: {
    presetId:   string
    presetName: string
    targetRef:  string
    mape:       number | null
    mae:        number | null
    n:          number
    error?:     string
  }[]
  overallMape: number | null
}> {
  // プリセット一覧取得
  const { data: presets } = await supabase
    .from('project_analysis_presets')
    .select('id, name, target_metric_ref, feature_metric_refs')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)

  if (!presets || presets.length === 0) {
    return { presetResults: [], overallMape: null }
  }

  const presetIds = presets.map(p => p.id as string)

  // 各プリセットの最新重みバージョン取得
  const { data: weights } = await supabase
    .from('kpi_weight_versions')
    .select('preset_id, intercept, coefficients, feature_refs, n_obs, analysis_start, analysis_end')
    .in('preset_id', presetIds)
    .order('version_no', { ascending: false })

  const latestWeightMap = new Map<string, Record<string, unknown>>()
  for (const w of weights ?? []) {
    const pid = w.preset_id as string
    if (!latestWeightMap.has(pid)) latestWeightMap.set(pid, w as Record<string, unknown>)
  }

  const presetResults: Awaited<ReturnType<typeof evaluateMape>>['presetResults'] = []
  const allMapes: number[] = []

  for (const preset of presets) {
    const presetId   = preset.id as string
    const presetName = preset.name as string
    const targetRef  = preset.target_metric_ref as string
    const featureRefs = preset.feature_metric_refs as string[]

    const weight = latestWeightMap.get(presetId)
    if (!weight) {
      presetResults.push({
        presetId, presetName, targetRef,
        mape: null, mae: null, n: 0,
        error: '分析済みの重みバージョンが見つかりません',
      })
      continue
    }

    try {
      const intercept    = weight.intercept as number
      const coefficients = weight.coefficients as { label: string; coef: number }[]
      const allRefs      = [targetRef, ...featureRefs]

      const { table: wideMap } = await buildWideTable(
        supabase, projectId, allRefs, startDate, endDate, timeUnit,
      )

      const dates = Object.keys(wideMap).sort()
      let sumMape = 0, sumMae = 0, count = 0

      for (const d of dates) {
        const row    = wideMap[d]
        const actual = row?.[targetRef]
        if (actual == null) continue

        const predicted = intercept + coefficients.reduce((s, c) => {
          const xVal = row?.[c.label] ?? null
          return xVal != null ? s + c.coef * xVal : s
        }, 0)

        if (actual !== 0) {
          sumMape += Math.abs((actual - predicted) / actual)
        }
        sumMae += Math.abs(actual - predicted)
        count++
      }

      const mape = count > 0 ? Math.round((sumMape / count) * 10000) / 100 : null  // %
      const mae  = count > 0 ? Math.round((sumMae / count) * 100) / 100 : null

      if (mape !== null) allMapes.push(mape)

      presetResults.push({ presetId, presetName, targetRef, mape, mae, n: count })
    } catch (err) {
      console.error(`[evaluateMape] presetId=${presetId}`, err)
      presetResults.push({
        presetId, presetName, targetRef,
        mape: null, mae: null, n: 0,
        error: '評価中にエラーが発生しました',
      })
    }
  }

  const overallMape = allMapes.length > 0
    ? Math.round((allMapes.reduce((s, v) => s + v, 0) / allMapes.length) * 100) / 100
    : null

  return { presetResults, overallMape }
}
