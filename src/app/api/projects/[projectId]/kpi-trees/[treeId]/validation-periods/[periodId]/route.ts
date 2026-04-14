/**
 * GET    /api/projects/[projectId]/kpi-trees/[treeId]/validation-periods/[periodId]
 *   — 検証期間 1件取得
 *
 * DELETE /api/projects/[projectId]/kpi-trees/[treeId]/validation-periods/[periodId]
 *   — 検証期間削除
 *
 * POST   /api/projects/[projectId]/kpi-trees/[treeId]/validation-periods/[periodId]/evaluate
 *   — 手動で MAPE 評価を再実行（pending/failed 状態の期間に対して）
 *   ※ このエンドポイントは [periodId]/evaluate/route.ts に分離しても良い。
 *     ここでは PATCH + action で実装する。
 *
 * PATCH body: { action: 'evaluate' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type RouteParams = { params: Promise<{ projectId: string; treeId: string; periodId: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { projectId, treeId, periodId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { data, error } = await supabase
    .from('kpi_validation_periods')
    .select('*')
    .eq('id', periodId)
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)
    .single()

  if (error || !data) {
    return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { projectId, treeId, periodId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { error } = await supabase
    .from('kpi_validation_periods')
    .delete()
    .eq('id', periodId)
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

/**
 * PATCH: action='evaluate' で MAPE 再評価を実行する
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { projectId, treeId, periodId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (body?.action !== 'evaluate') {
    return NextResponse.json({ success: false, error: '未知の action です' }, { status: 400 })
  }

  // 対象期間を取得
  const { data: period, error: periodErr } = await supabase
    .from('kpi_validation_periods')
    .select('*')
    .eq('id', periodId)
    .eq('project_id', projectId)
    .eq('kpi_tree_id', treeId)
    .single()

  if (periodErr || !period) {
    return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 })
  }

  const today = new Date().toISOString().slice(0, 10)
  if ((period.end_date as string) >= today) {
    return NextResponse.json(
      { success: false, error: '終了日が未来の検証期間は評価できません（バッチ処理を待ってください）' },
      { status: 422 },
    )
  }

  // evaluating 状態にセット
  await supabase
    .from('kpi_validation_periods')
    .update({ status: 'evaluating', error_message: null })
    .eq('id', periodId)

  // 動的インポートで評価関数を呼ぶ（同一ファイルでは循環依存を避けるためルートの親から再利用）
  // ここでは直接同等の評価ロジックをインラインで呼ぶ
  try {
    const { buildWideTable } = await import('@/lib/analysis/regression')

    const startDate = period.start_date as string
    const endDate   = period.end_date   as string
    const timeUnit  = (period.time_unit ?? 'day') as 'day' | 'week' | 'month'

    const { data: presets } = await supabase
      .from('project_analysis_presets')
      .select('id, name, target_metric_ref, feature_metric_refs')
      .eq('project_id', projectId)
      .eq('kpi_tree_id', treeId)

    if (!presets || presets.length === 0) {
      await supabase
        .from('kpi_validation_periods')
        .update({ status: 'completed', results: { presetResults: [], overallMape: null }, evaluated_at: new Date().toISOString() })
        .eq('id', periodId)

      return NextResponse.json({ success: true, data: { ...period, status: 'completed', results: { presetResults: [], overallMape: null } } })
    }

    const presetIds = presets.map(p => p.id as string)
    const { data: weights } = await supabase
      .from('kpi_weight_versions')
      .select('preset_id, intercept, coefficients, feature_refs')
      .in('preset_id', presetIds)
      .order('version_no', { ascending: false })

    const latestWeightMap = new Map<string, Record<string, unknown>>()
    for (const w of weights ?? []) {
      const pid = w.preset_id as string
      if (!latestWeightMap.has(pid)) latestWeightMap.set(pid, w as Record<string, unknown>)
    }

    const presetResults: {
      presetId: string; presetName: string; targetRef: string
      mape: number | null; mae: number | null; n: number; error?: string
    }[] = []
    const allMapes: number[] = []

    for (const preset of presets) {
      const presetId   = preset.id as string
      const presetName = preset.name as string
      const targetRef  = preset.target_metric_ref as string
      const featureRefs = preset.feature_metric_refs as string[]
      const weight = latestWeightMap.get(presetId)

      if (!weight) {
        presetResults.push({ presetId, presetName, targetRef, mape: null, mae: null, n: 0, error: '重みバージョン未設定' })
        continue
      }

      const intercept    = weight.intercept as number
      const coefficients = weight.coefficients as { label: string; coef: number }[]
      const allRefs      = [targetRef, ...featureRefs]

      const { table: wideMap } = await buildWideTable(supabase, projectId, allRefs, startDate, endDate, timeUnit)
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
        if (actual !== 0) sumMape += Math.abs((actual - predicted) / actual)
        sumMae += Math.abs(actual - predicted)
        count++
      }

      const mape = count > 0 ? Math.round((sumMape / count) * 10000) / 100 : null
      const mae  = count > 0 ? Math.round((sumMae  / count) * 100)   / 100 : null
      if (mape !== null) allMapes.push(mape)
      presetResults.push({ presetId, presetName, targetRef, mape, mae, n: count })
    }

    const overallMape = allMapes.length > 0
      ? Math.round((allMapes.reduce((s, v) => s + v, 0) / allMapes.length) * 100) / 100
      : null

    const mapeResults = { presetResults, overallMape }

    const { data: updated } = await supabase
      .from('kpi_validation_periods')
      .update({ status: 'completed', results: mapeResults, evaluated_at: new Date().toISOString() })
      .eq('id', periodId)
      .select()
      .single()

    return NextResponse.json({ success: true, data: updated ?? { ...period, status: 'completed', results: mapeResults } })

  } catch (err) {
    console.error('[validation-periods evaluate]', err)
    await supabase
      .from('kpi_validation_periods')
      .update({ status: 'failed', error_message: '評価中にエラーが発生しました' })
      .eq('id', periodId)

    return NextResponse.json({ success: false, error: '評価に失敗しました' }, { status: 500 })
  }
}
