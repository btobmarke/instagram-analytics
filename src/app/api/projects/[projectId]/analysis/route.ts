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

const MIN_OBS = 10

// ── 数学ユーティリティ ──────────────────────────────────────────────────────────

/** Pearson 相関係数 */
function pearson(xs: (number | null)[], ys: (number | null)[]): { r: number; n: number } | null {
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
function invertMatrix(A: number[][]): number[][] | null {
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
    if (Math.abs(M[col][col]) < 1e-12) return null
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
function ridgeRegression(
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

  // X の平均・標準偏差
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
function computeVIF(
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

// ── ワイド表構築 ──────────────────────────────────────────────────────────────

function aggregationMode(colKey: string): 'sum' | 'avg' | 'last' {
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

async function buildWideTable(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  allRefs: string[],
  startDate: string,
  endDate: string,
  timeUnit: 'day' | 'week' | 'month',
): Promise<{ table: Record<string, Record<string, number | null>>; warnings: string[] }> {
  const warnings: string[] = []
  const isExternalRef = (colKey: string) => colKey.startsWith('external.')
  const externalField  = (colKey: string) => isExternalRef(colKey) ? colKey.slice('external.'.length) : null

  const refParsed = allRefs.map(ref => {
    const sep = ref.indexOf('::')
    if (sep < 0) return { colKey: ref, serviceId: null as string | null, metricRef: ref }
    return { colKey: ref, serviceId: ref.slice(0, sep), metricRef: ref.slice(sep + 2) }
  })

  const serviceIds = [...new Set(refParsed.filter(r => r.serviceId).map(r => r.serviceId!))]

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
  const externalCols = allRefs.filter(isExternalRef)
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

  if (timeUnit === 'day') return { table: rawMap, warnings }

  // week / month 集計
  const grouped: Record<string, {
    sums: Record<string, number>
    counts: Record<string, number>
    last: Record<string, { date: string; value: number }>
  }> = {}

  const modes = Object.fromEntries(allRefs.map(ref => [ref, aggregationMode(ref)])) as Record<string, 'sum' | 'avg' | 'last'>
  const modeSummary = {
    sum:  allRefs.filter(r => modes[r] === 'sum').length,
    avg:  allRefs.filter(r => modes[r] === 'avg').length,
    last: allRefs.filter(r => modes[r] === 'last').length,
  }
  warnings.push(`週次/月次集計（sum:${modeSummary.sum}, avg:${modeSummary.avg}, last:${modeSummary.last}）`)

  for (const [dateStr, values] of Object.entries(rawMap)) {
    const d = new Date(dateStr)
    let bucketKey: string
    if (timeUnit === 'week') {
      const mon = new Date(d)
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
      bucketKey = mon.toISOString().slice(0, 10)
    } else {
      bucketKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    if (!grouped[bucketKey]) grouped[bucketKey] = { sums: {}, counts: {}, last: {} }
    for (const [col, val] of Object.entries(values)) {
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
    for (const col of allRefs) {
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
