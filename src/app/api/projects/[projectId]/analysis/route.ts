/**
 * POST /api/projects/[projectId]/analysis
 *
 * ワイド表を構築し、相関行列・Ridge(OLS)回帰を計算して返す。
 * saveWeights=true の場合、kpi_weight_versions に結果を保存する。
 *
 * Body:
 *   {
 *     targetMetricRef:   string           // Y 変数
 *     featureMetricRefs: string[]         // X 変数リスト
 *     startDate:         string           // YYYY-MM-DD
 *     endDate:           string           // YYYY-MM-DD
 *     timeUnit?:         'day'|'week'|'month'  // default: 'day'
 *     ridgeLambda?:      number           // Ridge 正則化パラメータ (0=OLS)
 *     saveWeights?:      boolean          // 結果を DB に保存するか
 *     presetId?:         string           // saveWeights=true の場合必須
 *     versionName?:      string           // 保存時のバージョン名
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'
import {
  MIN_OBS,
  pearson,
  ridgeRegression,
  computeVIF,
  buildWideTable,
} from '@/lib/analysis/regression'

// ── バリデーション ─────────────────────────────────────────────────────────────

const BodySchema = z.object({
  targetMetricRef:   z.string().min(1),
  featureMetricRefs: z.array(z.string()).min(1).max(20),
  startDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeUnit:          z.enum(['day', 'week', 'month']).default('day'),
  ridgeLambda:       z.number().min(0).max(1000).default(0),
  saveWeights:       z.boolean().default(false),
  presetId:          z.string().uuid().optional(),
  versionName:       z.string().optional(),
})

// ── メインハンドラ ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const {
    targetMetricRef, featureMetricRefs, startDate, endDate, timeUnit,
    ridgeLambda, saveWeights, presetId, versionName,
  } = parsed.data

  if (startDate > endDate) {
    return NextResponse.json(
      { success: false, error: 'startDate は endDate 以前にしてください' },
      { status: 400 },
    )
  }

  const allRefs = [targetMetricRef, ...featureMetricRefs]
  const warnings: string[] = []

  // ── ワイド表構築 ─────────────────────────────────────────────────────────────
  const { table: wideMap, warnings: tableWarnings } = await buildWideTable(
    supabase, projectId, allRefs, startDate, endDate, timeUnit,
  )
  warnings.push(...tableWarnings)

  const dates = Object.keys(wideMap).sort()

  if (dates.length < MIN_OBS) {
    warnings.push(
      `有効な観測数が ${dates.length} 件です（推奨: ${MIN_OBS} 件以上）。結果の信頼性が低い可能性があります。`,
    )
  }

  const colVectors: Record<string, (number | null)[]> = {}
  for (const ref of allRefs) {
    colVectors[ref] = dates.map(d => wideMap[d]?.[ref] ?? null)
  }

  const wideTable = dates.map(d => ({
    date: d,
    ...Object.fromEntries(allRefs.map(ref => [ref, wideMap[d]?.[ref] ?? null])),
  }))

  // ── 相関行列 ─────────────────────────────────────────────────────────────────
  const correlation: { col1: string; col2: string; r: number; n: number }[] = []
  for (let i = 0; i < allRefs.length; i++) {
    for (let j = i; j < allRefs.length; j++) {
      const res = pearson(colVectors[allRefs[i]], colVectors[allRefs[j]])
      if (res) {
        correlation.push({ col1: allRefs[i], col2: allRefs[j], r: res.r, n: res.n })
      }
    }
  }

  // ── 回帰（Ridge or OLS）─────────────────────────────────────────────────────
  let regression: {
    target:       string
    features:     string[]
    coefficients: { label: string; coef: number }[]
    intercept:    number
    r2:           number
    n:            number
    ridgeLambda:  number
    vif:          { label: string; vif: number }[]
  } | null = null
  let vifResults: { label: string; vif: number }[] = []
  let hasCollinearity = false

  if (featureMetricRefs.length > 0) {
    const Xs = featureMetricRefs.map(ref => colVectors[ref])

    if (featureMetricRefs.length >= 2) {
      vifResults = computeVIF(Xs, featureMetricRefs)
      const highVIF = vifResults.filter(v => v.vif > 10)
      if (highVIF.length > 0) {
        hasCollinearity = true
        const names = highVIF.map(v => `${v.label}(VIF=${v.vif})`).join(', ')
        warnings.push(`多重共線性が検出されました: ${names}。Ridge 正則化（λ > 0）を推奨します。`)
        if (ridgeLambda === 0) {
          warnings.push('現在は OLS で実行しています。λ を 1〜10 に設定するとより安定します。')
        }
      }
    }

    const result = ridgeRegression(colVectors[targetMetricRef], Xs, featureMetricRefs, ridgeLambda)
    if (result) {
      regression = {
        target:       targetMetricRef,
        features:     featureMetricRefs,
        coefficients: result.coefficients,
        intercept:    result.intercept,
        r2:           result.r2,
        n:            result.n,
        ridgeLambda,
        vif:          vifResults,
      }
    } else {
      warnings.push('回帰を実行できませんでした（有効観測数不足、または特異行列）。')
    }
  }

  // ── 重み保存 ────────────────────────────────────────────────────────────────
  let savedWeightVersion: object | null = null
  if (saveWeights && presetId && regression) {
    const { data: existing } = await supabase
      .from('kpi_weight_versions')
      .select('version_no')
      .eq('preset_id', presetId)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextVersionNo = ((existing?.version_no as number | null) ?? 0) + 1

    const { data: saved, error: saveErr } = await supabase
      .from('kpi_weight_versions')
      .insert({
        project_id:          projectId,
        preset_id:           presetId,
        version_no:          nextVersionNo,
        name:                versionName ?? `v${nextVersionNo} (${new Date().toLocaleDateString('ja-JP')})`,
        target_ref:          targetMetricRef,
        feature_refs:        featureMetricRefs,
        coefficients:        regression.coefficients.map((c, i) => ({
          ...c,
          vif: vifResults[i]?.vif ?? null,
        })),
        intercept:           regression.intercept,
        r2:                  regression.r2,
        n_obs:               regression.n,
        ridge_lambda:        ridgeLambda,
        has_collinearity:    hasCollinearity,
        collinearity_detail: vifResults,
        analysis_start:      startDate,
        analysis_end:        endDate,
        time_unit:           timeUnit,
      })
      .select()
      .single()

    if (saveErr) {
      warnings.push(`重み保存に失敗しました: ${saveErr.message}`)
    } else {
      savedWeightVersion = saved
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      wideTable,
      columns:            allRefs,
      correlation,
      regression,
      vif:                vifResults,
      warnings,
      savedWeightVersion,
    },
  })
}
