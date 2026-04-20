/**
 * 標準化済みデザイン行列に対する Ridge / Lasso / ElasticNet（座標降下）および OLS。
 * 切片は説明変数列が平均 0 のとき mean(y) で復元する。
 */

export type PenaltyKind = 'ridge' | 'lasso' | 'elastic_net' | 'ols'

export type PenaltyParams = {
  kind: PenaltyKind
  /** Ridge / Lasso / ElasticNet の λ（OLS では無視） */
  lambda: number
  /** ElasticNet の α（0=L2のみ, 1=L1のみ）。ridge/lasso/ols では不要 */
  elasticAlpha?: number
}

const EPS = 1e-12

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / (xs.length || 1)
}

function softThreshold(x: number, t: number): number {
  if (x > t) return x - t
  if (x < -t) return x + t
  return 0
}

/** Gauss-Jordan（regression.ts と同ロジックの局所コピー） */
function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length
  const M: number[][] = A.map((row, i) =>
    [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))],
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
 * Xz: n×k（列は平均 0・分散 1 想定）, yz: 長さ n
 * 切片なしで β を推定し、interceptStd = mean(yz)（列中心化時）
 */
export function fitPenalizedStandardized(
  Xz: number[][],
  yz: number[],
  params: PenaltyParams,
  opts?: { maxIter?: number; tol?: number },
): { betaStd: number[]; interceptStd: number } | null {
  const n = yz.length
  const k = Xz[0]?.length ?? 0
  if (n === 0 || k === 0 || n !== Xz.length) return null

  const maxIter = opts?.maxIter ?? 5000
  const tol = opts?.tol ?? 1e-7

  const yBar = mean(yz)
  const ydm = yz.map(y => y - yBar)

  if (params.kind === 'ols' || params.lambda <= 0) {
    const XtX: number[][] = Array.from({ length: k }, (_, i) =>
      Array.from({ length: k }, (_, j) =>
        Xz.reduce((s, row) => s + row[i] * row[j], 0),
      ),
    )
    const Xty: number[] = Array.from({ length: k }, (_, i) =>
      Xz.reduce((s, row, rIdx) => s + row[i] * ydm[rIdx], 0),
    )
    const inv = invertMatrix(XtX)
    if (!inv) return null
    const betaStd = Array.from({ length: k }, (_, i) =>
      inv[i].reduce((s, v, j) => s + v * Xty[j], 0),
    )
    return { betaStd, interceptStd: yBar }
  }

  const lam = params.lambda
  const alpha = params.kind === 'elastic_net'
    ? Math.min(1, Math.max(0, params.elasticAlpha ?? 0.5))
    : params.kind === 'lasso'
      ? 1
      : 0

  // 列ごとの ||X_j||^2（標準化列ならおおよそ n）
  const colNorm2: number[] = []
  for (let j = 0; j < k; j++) {
    let s = 0
    for (let i = 0; i < n; i++) {
      const v = Xz[i][j]
      s += v * v
    }
    colNorm2.push(s)
  }

  let beta = Array.from({ length: k }, () => 0)

  for (let iter = 0; iter < maxIter; iter++) {
    const betaOld = [...beta]
    for (let j = 0; j < k; j++) {
      const denom = colNorm2[j] + lam * (1 - alpha)
      if (denom < EPS) continue

      let rho = 0
      for (let i = 0; i < n; i++) {
        const xi = Xz[i][j]
        const ri =
          ydm[i] -
          beta.reduce((s, b, jj) => (jj === j ? s : s + beta[jj] * Xz[i][jj]), 0)
        rho += xi * ri
      }

      const thresh = lam * alpha * n
      beta[j] = softThreshold(rho, thresh) / denom
    }

    const diff = Math.sqrt(beta.reduce((s, b, j) => s + (b - betaOld[j]) ** 2, 0))
    if (diff < tol) break
  }

  return { betaStd: beta, interceptStd: yBar }
}

export type CvSplit = { trainIdx: number[]; testIdx: number[] }

/** 時系列を先頭から連続ブロックに分割した K-fold（最後のブロックが小さくても可） */
export function timeSeriesKFoldIndices(n: number, k: number): CvSplit[] {
  const folds = Math.max(2, Math.min(k, n))
  const base = Math.floor(n / folds)
  let rem = n % folds
  const splits: CvSplit[] = []
  let start = 0
  for (let f = 0; f < folds; f++) {
    const len = base + (rem > 0 ? 1 : 0)
    if (rem > 0) rem--
    const testIdx = Array.from({ length: len }, (_, i) => start + i)
    const trainIdx = [
      ...Array.from({ length: start }, (_, i) => i),
      ...Array.from({ length: n - start - len }, (_, i) => start + len + i),
    ]
    splits.push({ trainIdx, testIdx })
    start += len
  }
  return splits
}

function predictRow(
  xzRow: number[],
  betaStd: number[],
  interceptStd: number,
): number {
  return interceptStd + xzRow.reduce((s, x, j) => s + betaStd[j] * x, 0)
}

export function rmseOnIndices(
  Xz: number[][],
  yz: number[],
  betaStd: number[],
  interceptStd: number,
  idx: number[],
): number {
  if (idx.length === 0) return Number.POSITIVE_INFINITY
  let s = 0
  for (const i of idx) {
    const e = yz[i] - predictRow(Xz[i], betaStd, interceptStd)
    s += e * e
  }
  return Math.sqrt(s / idx.length)
}

export function crossValidatePenalized(
  Xz: number[][],
  yz: number[],
  params: PenaltyParams,
  kFolds: number,
): { meanRmse: number; foldRmses: number[] } {
  const n = yz.length
  const splits = timeSeriesKFoldIndices(n, kFolds)
  const foldRmses: number[] = []

  for (const { trainIdx, testIdx } of splits) {
    if (trainIdx.length < 2) {
      foldRmses.push(Number.POSITIVE_INFINITY)
      continue
    }
    const Xtr = trainIdx.map(i => Xz[i])
    const ytr = trainIdx.map(i => yz[i])
    const fit = fitPenalizedStandardized(Xtr, ytr, params)
    if (!fit) {
      foldRmses.push(Number.POSITIVE_INFINITY)
      continue
    }
    foldRmses.push(rmseOnIndices(Xz, yz, fit.betaStd, fit.interceptStd, testIdx))
  }

  const finite = foldRmses.filter(Number.isFinite)
  const meanRmse =
    finite.length === 0
      ? Number.POSITIVE_INFINITY
      : finite.reduce((a, b) => a + b, 0) / finite.length

  return { meanRmse, foldRmses }
}
