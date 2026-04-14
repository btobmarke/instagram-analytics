import {
  invertMatrix,
  buildWideTable,
} from '@/lib/analysis/regression'
import type { SupabaseServerClient } from '@/lib/summary/fetch-metrics'

export type SummaryCardAnalysisModel = {
  type: 'ridge'
  standardized: true
  ridgeLambda: number
  // 標準化パラメータ
  yMean: number
  yStd: number
  xMeans: Record<string, number>
  xStds: Record<string, number>
  // 標準化空間での係数（表示の主役）
  interceptStd: number
  coefficientsStd: Array<{ colKey: string; coef: number }>
}

export type SummaryCardAnalysisMetrics = {
  r2: number
  mae: number
  rmse: number
  mape: number | null
  mapeExcluded: number
  n: number
}

export type SummaryCardAnalysisSeriesPoint = {
  period: string
  actual: number | null
  predicted: number | null
  residual: number | null
}

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / (xs.length || 1)
}

function std(xs: number[], mu: number): number {
  const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length || 1)
  return Math.sqrt(v) || 1
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000
}

export async function runSummaryCardRidgeAnalysis(params: {
  supabase: SupabaseServerClient
  projectId: string
  yColKey: string
  xColKeys: string[]
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD
  timeUnit: 'day' | 'week' | 'month'
  ridgeLambda: number
  minObs: number
}): Promise<{
  model: SummaryCardAnalysisModel
  metrics: SummaryCardAnalysisMetrics
  series: SummaryCardAnalysisSeriesPoint[]
  warnings: string[]
}> {
  const warnings: string[] = []
  const { supabase, projectId, yColKey, xColKeys, startDate, endDate, timeUnit, ridgeLambda, minObs } = params

  const allRefs = [yColKey, ...xColKeys]
  const { table: wideMap, warnings: tableWarnings } = await buildWideTable(
    supabase as unknown as Awaited<ReturnType<typeof import('@/lib/supabase/server').createSupabaseServerClient>>,
    projectId,
    allRefs,
    startDate,
    endDate,
    timeUnit,
  )
  warnings.push(...tableWarnings)

  const periods = Object.keys(wideMap).sort()

  // 学習に使う行（Yと全Xが揃っている）
  const rows: Array<{ key: string; y: number; xs: number[] }> = []
  for (const key of periods) {
    const r = wideMap[key] ?? {}
    const y = r[yColKey]
    if (y == null) continue
    const xs = xColKeys.map(k => r[k])
    if (xs.some(v => v == null)) continue
    rows.push({ key, y, xs: xs as number[] })
  }

  const n = rows.length
  const k = xColKeys.length
  if (n < minObs) {
    throw new Error(`INSUFFICIENT_DATA:n=${n}:minObs=${minObs}`)
  }
  if (n <= k + 1) {
    throw new Error(`INSUFFICIENT_DATA:n=${n}:k=${k}`)
  }

  const yVals = rows.map(r => r.y)
  const yMean = mean(yVals)
  const yStd = std(yVals, yMean)

  const xMeans: Record<string, number> = {}
  const xStds: Record<string, number> = {}
  for (let j = 0; j < k; j++) {
    const xs = rows.map(r => r.xs[j])
    const mu = mean(xs)
    const sd = std(xs, mu)
    xMeans[xColKeys[j]] = mu
    xStds[xColKeys[j]] = sd
  }

  // 標準化デザイン行列 Xz（n×k）と yz（n）
  const Xz: number[][] = rows.map(r =>
    r.xs.map((x, j) => (x - xMeans[xColKeys[j]]) / xStds[xColKeys[j]])
  )
  const yz: number[] = rows.map(r => (r.y - yMean) / yStd)

  // Ridge: beta = (X'X + λI)^-1 X'y
  const XtX: number[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) =>
      Xz.reduce((s, row) => s + row[i] * row[j], 0)
    )
  )
  if (ridgeLambda > 0) {
    for (let i = 0; i < k; i++) XtX[i][i] += ridgeLambda
  }
  const Xty: number[] = Array.from({ length: k }, (_, i) =>
    Xz.reduce((s, row, rIdx) => s + row[i] * yz[rIdx], 0)
  )

  const inv = invertMatrix(XtX)
  if (!inv) {
    throw new Error('SINGULAR_MATRIX')
  }

  const betaStd: number[] = Array.from({ length: k }, (_, i) =>
    inv[i].reduce((s, v, j) => s + v * Xty[j], 0)
  )
  const interceptStd = mean(yz) - betaStd.reduce((s, b, j) => s + b * mean(Xz.map(r => r[j])), 0)
  // Xz/yz は中心化済みなので mean はほぼ0だが、数値誤差対策でこの形にしておく

  // 予測と指標（元スケール）
  const predictFromRaw = (rawRow: Record<string, number | null>): number | null => {
    const yRaw = rawRow[yColKey] ?? null
    void yRaw
    const xs = xColKeys.map(k2 => rawRow[k2])
    if (xs.some(v => v == null)) return null
    const xz = xs.map((x, j) => ((x as number) - xMeans[xColKeys[j]]) / xStds[xColKeys[j]])
    const yZHat = interceptStd + xz.reduce((s, x, j) => s + betaStd[j] * x, 0)
    return yMean + yStd * yZHat
  }

  const series: SummaryCardAnalysisSeriesPoint[] = periods.map(key => {
    const raw = wideMap[key] ?? {}
    const actual = raw[yColKey] ?? null
    const predicted = predictFromRaw(raw)
    const residual =
      actual != null && predicted != null
        ? actual - predicted
        : null
    return { period: key, actual, predicted, residual }
  })

  const fittedPairs = series
    .filter(p => p.actual != null && p.predicted != null)
    .map(p => ({ y: p.actual as number, yhat: p.predicted as number }))

  const mae = fittedPairs.reduce((s, p) => s + Math.abs(p.y - p.yhat), 0) / (fittedPairs.length || 1)
  const rmse = Math.sqrt(fittedPairs.reduce((s, p) => s + (p.y - p.yhat) ** 2, 0) / (fittedPairs.length || 1))

  let mapeExcluded = 0
  const mapePairs = fittedPairs.filter(p => {
    if (Math.abs(p.y) < 1e-9) {
      mapeExcluded++
      return false
    }
    return true
  })
  const mape =
    mapePairs.length > 0
      ? (mapePairs.reduce((s, p) => s + Math.abs((p.y - p.yhat) / p.y), 0) / mapePairs.length) * 100
      : null

  const yBar = fittedPairs.reduce((s, p) => s + p.y, 0) / (fittedPairs.length || 1)
  const ssTot = fittedPairs.reduce((s, p) => s + (p.y - yBar) ** 2, 0)
  const ssRes = fittedPairs.reduce((s, p) => s + (p.y - p.yhat) ** 2, 0)
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  const model: SummaryCardAnalysisModel = {
    type: 'ridge',
    standardized: true,
    ridgeLambda,
    yMean: round4(yMean),
    yStd: round4(yStd),
    xMeans: Object.fromEntries(Object.entries(xMeans).map(([k2, v]) => [k2, round4(v)])),
    xStds: Object.fromEntries(Object.entries(xStds).map(([k2, v]) => [k2, round4(v)])),
    interceptStd: round4(interceptStd),
    coefficientsStd: xColKeys.map((k2, i) => ({ colKey: k2, coef: round4(betaStd[i]) })),
  }

  const metrics: SummaryCardAnalysisMetrics = {
    r2: round4(r2),
    mae: round4(mae),
    rmse: round4(rmse),
    mape: mape == null ? null : round4(mape),
    mapeExcluded,
    n: fittedPairs.length,
  }

  return { model, metrics, series, warnings }
}

