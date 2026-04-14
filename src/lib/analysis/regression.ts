/**
 * 共有回帰分析ユーティリティ
 * analysis/route.ts および preset-analysis routes から利用される。
 */

import { createSupabaseServerClient } from '@/lib/supabase/server'

export const MIN_OBS = 10

// ── 数学ユーティリティ ──────────────────────────────────────────────────────────

/** Pearson 相関係数 */
export function pearson(
  xs: (number | null)[],
  ys: (number | null)[],
): { r: number; n: number } | null {
  const pairs: [number, number][] = []
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] != null && ys[i] != null) pairs.push([xs[i]!, ys[i]!])
  }
  const n = pairs.length
  if (n < 3) return null

  const meanX = pairs.reduce((s, [x]) => s + x, 0) / n
  const meanY = pairs.reduce((s, [, y]) => s + y, 0) / n
  let num = 0, denX = 0, denY = 0
  for (const [x, y] of pairs) {
    const dx = x - meanX, dy = y - meanY
    num  += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  const den = Math.sqrt(denX * denY)
  if (den === 0) return null
  return { r: Math.round((num / den) * 10000) / 10000, n }
}

/** Gauss-Jordan 逆行列 */
export function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length
  const M: number[][] = A.map((row, i) =>
    [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]
  )
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row
    }
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    const maxAbs = Math.max(...M[col].map(v => Math.abs(v)))
    if (Math.abs(M[col][col]) < 1e-10 * (maxAbs || 1)) return null
    const scale = M[col][col]
    M[col] = M[col].map(v => v / scale)
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = M[row][col]
      M[row] = M[row].map((v, c) => v - f * M[col][c])
    }
  }
  return M.map(row => row.slice(n))
}

/**
 * Ridge 回帰: Y = b0 + b1*X1 + ... + bk*Xk
 * lambda=0 の場合は通常OLS。X は標準化してから回帰し、係数を元スケールに戻す。
 */
export function ridgeRegression(
  Y: (number | null)[],
  Xs: (number | null)[][],
  featureLabels: string[],
  lambda: number = 0,
): {
  intercept:    number
  coefficients: { label: string; coef: number }[]
  r2:           number
  n:            number
} | null {
  const rows: { y: number; xs: number[] }[] = []
  for (let i = 0; i < Y.length; i++) {
    if (Y[i] == null) continue
    const xRow = Xs.map(col => col[i])
    if (xRow.some(v => v == null)) continue
    rows.push({ y: Y[i]!, xs: xRow as number[] })
  }

  const n = rows.length
  const k = featureLabels.length
  if (n < MIN_OBS || n <= k + 1) return null

  const means = featureLabels.map((_, j) => {
    const vals = rows.map(r => r.xs[j])
    return vals.reduce((s, v) => s + v, 0) / n
  })
  const stds = featureLabels.map((_, j) => {
    const vals = rows.map(r => r.xs[j])
    const mu = means[j]
    const variance = vals.reduce((s, v) => s + (v - mu) ** 2, 0) / n
    return Math.sqrt(variance) || 1
  })

  const yMean = rows.reduce((s, r) => s + r.y, 0) / n
  const yStd  = Math.sqrt(rows.reduce((s, r) => s + (r.y - yMean) ** 2, 0) / n) || 1

  const Xstd: number[][] = rows.map(r => r.xs.map((v, j) => (v - means[j]) / stds[j]))

  const XtX: number[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) =>
      rows.reduce((s, _, r) => s + Xstd[r][i] * Xstd[r][j], 0)
    )
  )
  if (lambda > 0) {
    for (let i = 0; i < k; i++) XtX[i][i] += lambda
  }

  const yStdVec = rows.map(r => (r.y - yMean) / yStd)
  const Xty: number[] = Array.from({ length: k }, (_, i) =>
    rows.reduce((s, _, r) => s + Xstd[r][i] * yStdVec[r], 0)
  )

  const inv = invertMatrix(XtX)
  if (!inv) return null

  const betaStd: number[] = Array.from({ length: k }, (_, i) =>
    inv[i].reduce((s, v, j) => s + v * Xty[j], 0)
  )
  const beta: number[] = betaStd.map((b, j) => b * (yStd / stds[j]))
  const intercept = yMean - beta.reduce((s, b, j) => s + b * means[j], 0)

  const ssTot = rows.reduce((s, r) => s + (r.y - yMean) ** 2, 0)
  let ssRes = 0
  for (const row of rows) {
    const yHat = intercept + row.xs.reduce((s, x, j) => s + beta[j] * x, 0)
    ssRes += (row.y - yHat) ** 2
  }
  const r2 = ssTot === 0 ? 0 : Math.round((1 - ssRes / ssTot) * 10000) / 10000

  return {
    intercept: Math.round(intercept * 10000) / 10000,
    coefficients: featureLabels.map((label, i) => ({
      label,
      coef: Math.round(beta[i] * 10000) / 10000,
    })),
    r2,
    n,
  }
}

/** VIF 計算 */
export function computeVIF(
  Xs: (number | null)[][],
  featureLabels: string[],
): { label: string; vif: number }[] {
  const k = featureLabels.length
  if (k < 2) return featureLabels.map(label => ({ label, vif: 1 }))

  return featureLabels.map((label, target) => {
    const others = Xs.filter((_, j) => j !== target)
    const otherLabels = featureLabels.filter((_, j) => j !== target)
    const result = ridgeRegression(Xs[target], others, otherLabels, 0)
    if (!result) return { label, vif: 1 }
    const r2 = result.r2
    const vif = r2 >= 1 ? 999 : Math.round((1 / (1 - r2)) * 100) / 100
    return { label, vif }
  })
}

// ── 集計モード判定 ────────────────────────────────────────────────────────────

export function aggregationMode(colKey: string): 'sum' | 'avg' | 'last' {
  const metricRef = colKey.includes('::') ? colKey.split('::').slice(1).join('::') : colKey
  const m = metricRef.toLowerCase()
  if (m.includes('rate') || m.includes('ctr') || m.includes('ratio')) return 'avg'
  if (m.includes('seconds') || m.includes('duration')) return 'avg'
  if (m.startsWith('external.')) {
    if (m === 'external.is_holiday') return 'last'
    return 'avg'
  }
  if (m.includes('follower_count') || m.includes('contacts')) return 'last'
  return 'sum'
}

// ── カスタム指標フォーミュラ評価 ──────────────────────────────────────────────

/**
 * カスタム指標の数式を評価して値を返す。
 * 数式中の他指標参照: {{colKey}} 形式。
 * 例: "{{svcId::likes}} / {{svcId::reach}} * 100"
 * いずれかの参照先が null の場合は null を返す。
 */
export function evaluateFormula(
  formula: string,
  rowValues: Record<string, number | null>,
): number | null {
  try {
    // {{colKey}} を実際の値に置換
    let expr = formula
    const refs = Array.from(formula.matchAll(/\{\{([^}]+)\}\}/g))

    for (const match of refs) {
      const colKey = match[1].trim()
      const val    = rowValues[colKey]
      if (val == null) return null  // 依存指標が null → 結果も null
      // 安全な置換: すべての出現箇所を数値で置換
      expr = expr.replaceAll(match[0], String(val))
    }

    // 残った {{...}} があれば参照先が存在しない
    if (/\{\{/.test(expr)) return null

    // 安全な算術評価: +, -, *, /, (, ), 数値のみ許可
    if (!/^[\d\s+\-*/().eE-]+$/.test(expr)) return null

    // eslint-disable-next-line no-new-func
    const result = Function(`'use strict'; return (${expr})`)() as unknown
    if (typeof result !== 'number' || !isFinite(result)) return null
    return Math.round(result * 1e8) / 1e8  // 小数点以下8桁丸め
  } catch {
    return null
  }
}

/**
 * 数式中で参照されている colKey 一覧を抽出する。
 */
export function extractFormulaRefs(formula: string): string[] {
  return Array.from(formula.matchAll(/\{\{([^}]+)\}\}/g)).map(m => m[1].trim())
}

// ── ワイド表構築 ──────────────────────────────────────────────────────────────

export async function buildWideTable(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  allRefs: string[],
  startDate: string,
  endDate: string,
  timeUnit: 'day' | 'week' | 'month',
): Promise<{ table: Record<string, Record<string, number | null>>; warnings: string[] }> {
  const warnings: string[] = []
  const isExternalRef = (colKey: string) => colKey.startsWith('external.')
  const isCustomRef   = (colKey: string) => colKey.startsWith('custom::')
  const externalField = (colKey: string) => isExternalRef(colKey) ? colKey.slice('external.'.length) : null

  // カスタム指標 colKey の分離（custom::{id}）
  const customColKeys = allRefs.filter(isCustomRef)
  const normalRefs    = allRefs.filter(r => !isCustomRef(r))

  // カスタム指標の定義を取得
  type CustomMetricDef = { id: string; name: string; formula: string; unit: string | null }
  const customDefs = new Map<string, CustomMetricDef>()
  if (customColKeys.length > 0) {
    const ids = customColKeys.map(c => c.slice('custom::'.length))
    const { data: customRows, error: customErr } = await supabase
      .from('project_custom_metrics')
      .select('id, name, formula, unit')
      .eq('project_id', projectId)
      .in('id', ids)

    if (customErr) {
      warnings.push(`カスタム指標の取得に失敗: ${customErr.message}`)
    } else {
      for (const r of customRows ?? []) {
        customDefs.set(`custom::${r.id}`, r as CustomMetricDef)
      }
    }
  }

  // カスタム指標が依存している参照先を normalRefs に追加（重複除去）
  const extraRefs: string[] = []
  for (const [, def] of customDefs) {
    for (const ref of extractFormulaRefs(def.formula)) {
      if (!normalRefs.includes(ref) && !extraRefs.includes(ref)) {
        extraRefs.push(ref)
      }
    }
  }
  const baseRefs = [...normalRefs, ...extraRefs]

  const refParsed = baseRefs.map(ref => {
    const sep = ref.indexOf('::')
    if (sep < 0) return { colKey: ref, serviceId: null as string | null, metricRef: ref }
    return { colKey: ref, serviceId: ref.slice(0, sep), metricRef: ref.slice(sep + 2) }
  })

  // カスタム指標の serviceId は null 扱いなので除外
  const serviceIds = [...new Set(
    refParsed.filter(r => r.serviceId && !r.colKey.startsWith('custom::')).map(r => r.serviceId!)
  )]

  const { data: rows, error } = await supabase
    .from('project_metrics_daily')
    .select('service_id, date, metric_ref, value')
    .eq('project_id', projectId)
    .in('service_id', serviceIds.length > 0 ? serviceIds : ['__none__'])
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })

  if (error) {
    warnings.push(`DB エラー: ${error.message}`)
    return { table: {}, warnings }
  }

  const rawMap: Record<string, Record<string, number | null>> = {}

  for (const row of rows ?? []) {
    const dateStr = String(row.date).slice(0, 10)
    const matchRef = refParsed.find(
      r => r.serviceId === row.service_id && r.metricRef === row.metric_ref
    )
    if (!matchRef) continue
    if (!rawMap[dateStr]) rawMap[dateStr] = {}
    rawMap[dateStr][matchRef.colKey] = row.value as number | null
  }

  // 外生変数
  const externalCols = baseRefs.filter(isExternalRef)
  if (externalCols.length > 0) {
    const { data: extRows, error: extErr } = await supabase
      .from('project_external_daily')
      .select('date, is_holiday, temperature_max, temperature_min, precipitation_mm, weather_code')
      .eq('project_id', projectId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })

    if (extErr) {
      warnings.push(`外生変数の取得に失敗: ${extErr.message}`)
    } else {
      for (const r of extRows ?? []) {
        const dateStr = String(r.date).slice(0, 10)
        if (!rawMap[dateStr]) rawMap[dateStr] = {}
        for (const colKey of externalCols) {
          const f = externalField(colKey)
          if (!f) continue
          let v: number | null = null
          if (f === 'is_holiday') v = r.is_holiday == null ? null : (r.is_holiday ? 1 : 0)
          else if (f === 'temperature_max') v = (r.temperature_max as number | null) ?? null
          else if (f === 'temperature_min') v = (r.temperature_min as number | null) ?? null
          else if (f === 'precipitation_mm') v = (r.precipitation_mm as number | null) ?? null
          else if (f === 'weather_code') v = (r.weather_code as number | null) ?? null
          rawMap[dateStr][colKey] = v
        }
      }
    }
  }

  // カスタム指標：各日付で数式を評価して値を計算
  if (customColKeys.length > 0) {
    for (const dateStr of Object.keys(rawMap)) {
      for (const colKey of customColKeys) {
        const def = customDefs.get(colKey)
        if (!def) {
          rawMap[dateStr][colKey] = null
          warnings.push(`カスタム指標 ${colKey} の定義が見つかりません`)
          continue
        }
        rawMap[dateStr][colKey] = evaluateFormula(def.formula, rawMap[dateStr])
      }
    }
    if (customDefs.size > 0) {
      warnings.push(`カスタム指標 ${customColKeys.length} 件を数式で計算しました`)
    }
  }

  if (timeUnit === 'day') return { table: rawMap, warnings }

  // week / month 集計
  const grouped: Record<string, {
    sums: Record<string, number>
    counts: Record<string, number>
    last: Record<string, { date: string; value: number }>
  }> = {}

  // 集計対象は baseRefs（カスタム指標の依存元を含む）+ customColKeys
  const allRefsForAgg = [...new Set([...baseRefs, ...customColKeys])]
  const modes = Object.fromEntries(allRefsForAgg.map(ref => [ref, aggregationMode(ref)])) as Record<string, 'sum' | 'avg' | 'last'>
  // カスタム指標は計算値なので avg 扱い（集計後に再計算する）
  for (const col of customColKeys) modes[col] = 'avg'

  const modeSummary = {
    sum:  allRefsForAgg.filter(r => modes[r] === 'sum').length,
    avg:  allRefsForAgg.filter(r => modes[r] === 'avg').length,
    last: allRefsForAgg.filter(r => modes[r] === 'last').length,
  }
  warnings.push(`週次/月次集計（sum:${modeSummary.sum}, avg:${modeSummary.avg}, last:${modeSummary.last}）`)

  for (const [dateStr, values] of Object.entries(rawMap)) {
    const d = new Date(dateStr + 'T00:00:00Z')
    let bucketKey: string
    if (timeUnit === 'week') {
      const dayOfWeek = d.getUTCDay()
      const daysToMonday = (dayOfWeek + 6) % 7
      const mon = new Date(d.getTime() - daysToMonday * 86400_000)
      bucketKey = mon.toISOString().slice(0, 10)
    } else {
      bucketKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    }
    if (!grouped[bucketKey]) grouped[bucketKey] = { sums: {}, counts: {}, last: {} }
    for (const [col, val] of Object.entries(values)) {
      // カスタム指標は日次で既に計算済みなのでそのまま avg 集計
      if (val == null) continue
      const mode = modes[col] ?? 'sum'
      if (mode === 'last') {
        const cur = grouped[bucketKey].last[col]
        if (!cur || dateStr >= cur.date) grouped[bucketKey].last[col] = { date: dateStr, value: val }
      } else {
        grouped[bucketKey].sums[col]   = (grouped[bucketKey].sums[col]   ?? 0) + val
        grouped[bucketKey].counts[col] = (grouped[bucketKey].counts[col] ?? 0) + 1
      }
    }
  }

  const aggTable: Record<string, Record<string, number | null>> = {}
  for (const [bucket, { sums, counts }] of Object.entries(grouped)) {
    aggTable[bucket] = {}
    for (const col of allRefsForAgg) {
      const mode = modes[col] ?? 'sum'
      if (mode === 'last') {
        aggTable[bucket][col] = grouped[bucket].last[col]?.value ?? null
      } else if (mode === 'avg') {
        aggTable[bucket][col] = counts[col] ? sums[col] / counts[col] : null
      } else {
        aggTable[bucket][col] = counts[col] ? sums[col] : null
      }
    }
  }

  return { table: aggTable, warnings }
}

// ── 回帰実行ヘルパー（API ルートから再利用）─────────────────────────────────────

export type RegressionResult = {
  target:       string
  features:     string[]
  coefficients: { label: string; coef: number; vif?: number | null }[]
  intercept:    number
  r2:           number
  n:            number
  ridgeLambda:  number
  vif:          { label: string; vif: number }[]
  hasCollinearity: boolean
  warnings:     string[]
}

/**
 * プリセットに対して Ridge/OLS 回帰を実行し結果を返す。
 * DB への保存は行わない（呼び出し側の責任）。
 */
export async function runRegressionForPreset(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  targetMetricRef: string,
  featureMetricRefs: string[],
  startDate: string,
  endDate: string,
  timeUnit: 'day' | 'week' | 'month',
  ridgeLambda: number,
): Promise<{ result: RegressionResult | null; warnings: string[] }> {
  const warnings: string[] = []
  const allRefs = [targetMetricRef, ...featureMetricRefs]

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

  const Xs = featureMetricRefs.map(ref => colVectors[ref])

  let vifResults: { label: string; vif: number }[] = []
  let hasCollinearity = false

  if (featureMetricRefs.length >= 2) {
    vifResults = computeVIF(Xs, featureMetricRefs)
    const highVIF = vifResults.filter(v => v.vif > 10)
    if (highVIF.length > 0) {
      hasCollinearity = true
      const names = highVIF.map(v => `${v.label}(VIF=${v.vif})`).join(', ')
      warnings.push(`多重共線性が検出されました: ${names}。Ridge 正則化（λ > 0）を推奨します。`)
    }
  }

  const reg = ridgeRegression(colVectors[targetMetricRef], Xs, featureMetricRefs, ridgeLambda)
  if (!reg) {
    warnings.push('回帰を実行できませんでした（有効観測数不足、または特異行列）。')
    return { result: null, warnings }
  }

  return {
    result: {
      target:       targetMetricRef,
      features:     featureMetricRefs,
      coefficients: reg.coefficients.map((c, i) => ({
        ...c,
        vif: vifResults[i]?.vif ?? null,
      })),
      intercept:    reg.intercept,
      r2:           reg.r2,
      n:            reg.n,
      ridgeLambda,
      vif:          vifResults,
      hasCollinearity,
      warnings,
    },
    warnings,
  }
}

/**
 * 回帰結果を kpi_weight_versions に保存し、プリセットの is_stale を false に更新する。
 */
export async function saveWeightVersion(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  presetId: string,
  result: RegressionResult,
  startDate: string,
  endDate: string,
  timeUnit: 'day' | 'week' | 'month',
  versionName?: string,
): Promise<{ saved: Record<string, unknown> | null; error: string | null }> {
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
      target_ref:          result.target,
      feature_refs:        result.features,
      coefficients:        result.coefficients,
      intercept:           result.intercept,
      r2:                  result.r2,
      n_obs:               result.n,
      ridge_lambda:        result.ridgeLambda,
      has_collinearity:    result.hasCollinearity,
      collinearity_detail: result.vif,
      analysis_start:      startDate,
      analysis_end:        endDate,
      time_unit:           timeUnit,
    })
    .select()
    .single()

  if (saveErr) {
    return { saved: null, error: saveErr.message }
  }

  // is_stale をリセット
  await supabase
    .from('project_analysis_presets')
    .update({ is_stale: false })
    .eq('id', presetId)

  return { saved: saved as Record<string, unknown>, error: null }
}
