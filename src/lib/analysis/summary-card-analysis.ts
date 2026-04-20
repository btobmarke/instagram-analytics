import {
  invertMatrix,
  buildWideTable,
} from '@/lib/analysis/regression'
import type { SupabaseServerClient } from '@/lib/summary/fetch-metrics'
import {
  fitPenalizedStandardized,
  timeSeriesKFoldIndices,
  type PenaltyKind,
  type PenaltyParams,
} from '@/lib/analysis/penalized-regression'

export type SummaryCardPenaltyType = PenaltyKind

export type SummaryCardAnalysisModel = {
  type: SummaryCardPenaltyType
  standardized: true
  ridgeLambda: number
  elasticAlpha?: number | null
  // 標準化パラメータ（学習データ＝全期間または CV の訓練折に依存して API 側で設定）
  yMean: number
  yStd: number
  xMeans: Record<string, number>
  xStds: Record<string, number>
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

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000
}

export type CompleteCaseRow = { key: string; y: number; xs: number[] }

export function extractCompleteCaseRows(
  wideMap: Record<string, Record<string, number | null>>,
  yColKey: string,
  xColKeys: string[],
): CompleteCaseRow[] {
  const periods = Object.keys(wideMap).sort()
  const rows: CompleteCaseRow[] = []
  for (const key of periods) {
    const r = wideMap[key] ?? {}
    const y = r[yColKey]
    if (y == null) continue
    const xs = xColKeys.map(k => r[k])
    if (xs.some(v => v == null)) continue
    rows.push({ key, y, xs: xs as number[] })
  }
  return rows
}

function standardizeRows(
  rows: CompleteCaseRow[],
  xColKeys: string[],
): {
  Xz: number[][]
  yz: number[]
  yMean: number
  yStd: number
  xMeans: Record<string, number>
  xStds: Record<string, number>
} {
  const n = rows.length
  const k = xColKeys.length
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

  const Xz: number[][] = rows.map(r =>
    r.xs.map((x, j) => (x - xMeans[xColKeys[j]]) / xStds[xColKeys[j]]),
  )
  const yz: number[] = rows.map(r => (r.y - yMean) / yStd)

  return { Xz, yz, yMean, yStd, xMeans, xStds }
}

function toPenaltyParams(
  type: SummaryCardPenaltyType,
  lambda: number,
  elasticAlpha?: number | null,
): PenaltyParams {
  if (type === 'ols') return { kind: 'ols', lambda: 0 }
  if (type === 'ridge') return { kind: 'ridge', lambda }
  if (type === 'lasso') return { kind: 'lasso', lambda }
  return {
    kind: 'elastic_net',
    lambda,
    elasticAlpha: elasticAlpha ?? 0.5,
  }
}

function predictRaw(
  rawRow: Record<string, number | null>,
  yColKey: string,
  xColKeys: string[],
  yMean: number,
  yStd: number,
  xMeans: Record<string, number>,
  xStds: Record<string, number>,
  interceptStd: number,
  betaStd: number[],
): number | null {
  const xs = xColKeys.map(k2 => rawRow[k2])
  if (xs.some(v => v == null)) return null
  const xz = xs.map((x, j) => ((x as number) - xMeans[xColKeys[j]]) / xStds[xColKeys[j]])
  const yZHat = interceptStd + xz.reduce((s, x, j) => s + betaStd[j] * x, 0)
  return yMean + yStd * yZHat
}

function metricsFromSeries(
  series: SummaryCardAnalysisSeriesPoint[],
): SummaryCardAnalysisMetrics {
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

  return {
    r2: round4(r2),
    mae: round4(mae),
    rmse: round4(rmse),
    mape: mape == null ? null : round4(mape),
    mapeExcluded,
    n: fittedPairs.length,
  }
}

export type RunSummaryCardAnalysisParams = {
  supabase: SupabaseServerClient
  projectId: string
  yColKey: string
  xColKeys: string[]
  startDate: string
  endDate: string
  timeUnit: 'day' | 'week' | 'month'
  penaltyType: SummaryCardPenaltyType
  /** Ridge/Lasso/ElasticNet の λ。OLS では 0 */
  lambda: number
  elasticAlpha?: number | null
  minObs: number
}

/**
 * 全期間の完全ケース行で標準化→学習し、全期間に予測系列を付与。
 */
export async function runSummaryCardAnalysis(
  params: RunSummaryCardAnalysisParams,
): Promise<{
  model: SummaryCardAnalysisModel
  metrics: SummaryCardAnalysisMetrics
  series: SummaryCardAnalysisSeriesPoint[]
  warnings: string[]
}> {
  const warnings: string[] = []
  const {
    supabase,
    projectId,
    yColKey,
    xColKeys,
    startDate,
    endDate,
    timeUnit,
    penaltyType,
    lambda,
    elasticAlpha,
    minObs,
  } = params

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
  const rows = extractCompleteCaseRows(wideMap, yColKey, xColKeys)

  const n = rows.length
  const k = xColKeys.length
  if (n < minObs) {
    throw new Error(`INSUFFICIENT_DATA:n=${n}:minObs=${minObs}`)
  }
  if (n <= k + 1) {
    throw new Error(`INSUFFICIENT_DATA:n=${n}:k=${k}`)
  }

  const { Xz, yz, yMean, yStd, xMeans, xStds } = standardizeRows(rows, xColKeys)
  const pParams = toPenaltyParams(penaltyType, lambda, elasticAlpha)

  let betaStd: number[]
  let interceptStd: number

  if (penaltyType === 'ridge' && lambda > 0) {
    const XtX: number[][] = Array.from({ length: k }, (_, i) =>
      Array.from({ length: k }, (_, j) =>
        Xz.reduce((s, row) => s + row[i] * row[j], 0),
      ),
    )
    for (let i = 0; i < k; i++) XtX[i][i] += lambda
    const Xty: number[] = Array.from({ length: k }, (_, i) =>
      Xz.reduce((s, row, rIdx) => s + row[i] * yz[rIdx], 0),
    )
    const inv = invertMatrix(XtX)
    if (!inv) throw new Error('SINGULAR_MATRIX')
    betaStd = Array.from({ length: k }, (_, i) =>
      inv[i].reduce((s, v, j) => s + v * Xty[j], 0),
    )
    interceptStd =
      mean(yz) -
      betaStd.reduce((s, b, j) => s + b * mean(Xz.map(r => r[j])), 0)
  } else {
    const fit = fitPenalizedStandardized(Xz, yz, pParams)
    if (!fit) throw new Error('SINGULAR_MATRIX')
    betaStd = fit.betaStd
    interceptStd = fit.interceptStd
  }

  const predictFromRaw = (rawRow: Record<string, number | null>): number | null =>
    predictRaw(rawRow, yColKey, xColKeys, yMean, yStd, xMeans, xStds, interceptStd, betaStd)

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

  const metrics = metricsFromSeries(series)

  const model: SummaryCardAnalysisModel = {
    type: penaltyType,
    standardized: true,
    ridgeLambda: round4(lambda),
    elasticAlpha:
      penaltyType === 'elastic_net'
        ? round4(Math.min(1, Math.max(0, elasticAlpha ?? 0.5)))
        : null,
    yMean: round4(yMean),
    yStd: round4(yStd),
    xMeans: Object.fromEntries(Object.entries(xMeans).map(([k2, v]) => [k2, round4(v)])),
    xStds: Object.fromEntries(Object.entries(xStds).map(([k2, v]) => [k2, round4(v)])),
    interceptStd: round4(interceptStd),
    coefficientsStd: xColKeys.map((k2, i) => ({ colKey: k2, coef: round4(betaStd[i]) })),
  }

  return { model, metrics, series, warnings }
}

/** @deprecated runSummaryCardAnalysis を使用 */
export async function runSummaryCardRidgeAnalysis(params: {
  supabase: SupabaseServerClient
  projectId: string
  yColKey: string
  xColKeys: string[]
  startDate: string
  endDate: string
  timeUnit: 'day' | 'week' | 'month'
  ridgeLambda: number
  minObs: number
}): ReturnType<typeof runSummaryCardAnalysis> {
  return runSummaryCardAnalysis({
    ...params,
    penaltyType: 'ridge',
    lambda: params.ridgeLambda,
  })
}

export type CvPatternInput = {
  penaltyType: SummaryCardPenaltyType
  lambda: number
  elasticAlpha?: number | null
}

export type CvPatternResult = CvPatternInput & {
  meanRmse: number
  foldRmses: number[]
  kFolds: number
}

/**
 * 各パターンについて時系列 K-fold CV（訓練折内で再標準化）の平均 RMSE を返す。
 */
export async function runSummaryCardCvPatterns(params: {
  supabase: SupabaseServerClient
  projectId: string
  yColKey: string
  xColKeys: string[]
  startDate: string
  endDate: string
  timeUnit: 'day' | 'week' | 'month'
  patterns: CvPatternInput[]
  kFolds: number
  minObs: number
}): Promise<{
  patterns: CvPatternResult[]
  warnings: string[]
}> {
  const warnings: string[] = []
  const {
    supabase,
    projectId,
    yColKey,
    xColKeys,
    startDate,
    endDate,
    timeUnit,
    patterns,
    kFolds,
    minObs,
  } = params

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

  const rows = extractCompleteCaseRows(wideMap, yColKey, xColKeys)
  const n = rows.length
  if (n < minObs) {
    throw new Error(`INSUFFICIENT_DATA:n=${n}:minObs=${minObs}`)
  }

  const splits = timeSeriesKFoldIndices(n, kFolds)

  const results: CvPatternResult[] = []

  for (const pat of patterns) {
    const foldRmses: number[] = []
    for (const { trainIdx, testIdx } of splits) {
      const trainRows = trainIdx.map(i => rows[i])
      if (trainRows.length < minObs) {
        foldRmses.push(Number.POSITIVE_INFINITY)
        continue
      }
      const { Xz, yz, yMean, yStd, xMeans, xStds } = standardizeRows(trainRows, xColKeys)
      const pParams = toPenaltyParams(pat.penaltyType, pat.lambda, pat.elasticAlpha)

      let betaStd: number[]
      let interceptStd: number
      if (pat.penaltyType === 'ridge' && pat.lambda > 0) {
        const k = xColKeys.length
        const XtX: number[][] = Array.from({ length: k }, (_, i) =>
          Array.from({ length: k }, (_, j) =>
            Xz.reduce((s, row) => s + row[i] * row[j], 0),
          ),
        )
        for (let i = 0; i < k; i++) XtX[i][i] += pat.lambda
        const Xty: number[] = Array.from({ length: k }, (_, i) =>
          Xz.reduce((s, row, rIdx) => s + row[i] * yz[rIdx], 0),
        )
        const inv = invertMatrix(XtX)
        if (!inv) {
          foldRmses.push(Number.POSITIVE_INFINITY)
          continue
        }
        betaStd = Array.from({ length: k }, (_, i) =>
          inv[i].reduce((s, v, j) => s + v * Xty[j], 0),
        )
        interceptStd =
          mean(yz) -
          betaStd.reduce((s, b, j) => s + b * mean(Xz.map(r => r[j])), 0)
      } else {
        const fit = fitPenalizedStandardized(Xz, yz, pParams)
        if (!fit) {
          foldRmses.push(Number.POSITIVE_INFINITY)
          continue
        }
        betaStd = fit.betaStd
        interceptStd = fit.interceptStd
      }

      const yTest: number[] = []
      const predTest: number[] = []
      for (const ti of testIdx) {
        const raw = wideMap[rows[ti].key] ?? {}
        const y = raw[yColKey]
        if (y == null) continue
        const pred = predictRaw(
          raw,
          yColKey,
          xColKeys,
          yMean,
          yStd,
          xMeans,
          xStds,
          interceptStd,
          betaStd,
        )
        if (pred == null) continue
        yTest.push(y as number)
        predTest.push(pred)
      }
      if (yTest.length === 0) {
        foldRmses.push(Number.POSITIVE_INFINITY)
        continue
      }
      let s = 0
      for (let i = 0; i < yTest.length; i++) {
        const e = yTest[i] - predTest[i]
        s += e * e
      }
      foldRmses.push(Math.sqrt(s / yTest.length))
    }

    const finite = foldRmses.filter(Number.isFinite)
    const meanRmse =
      finite.length === 0
        ? Number.POSITIVE_INFINITY
        : finite.reduce((a, b) => a + b, 0) / finite.length

    results.push({
      ...pat,
      meanRmse,
      foldRmses,
      kFolds,
    })
  }

  return { patterns: results, warnings }
}
