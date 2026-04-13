/**
 * POST /api/projects/[projectId]/analysis
 *
 * ワイド表を構築し、相関行列と OLS 回帰を計算して返す。
 *
 * Body:
 *   {
 *     targetMetricRef:   string           // Y 変数
 *     featureMetricRefs: string[]         // X 変数リスト
 *     startDate:         string           // YYYY-MM-DD
 *     endDate:           string           // YYYY-MM-DD
 *     timeUnit?:         'day'|'week'|'month'  // default: 'day'
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       wideTable:   Array<{ date: string; [colKey: string]: number | null }>
 *       columns:     string[]          // colKey の一覧
 *       correlation: { col1: string; col2: string; r: number; n: number }[]
 *       regression?: {
 *         target:      string
 *         features:    string[]
 *         coefficients: { label: string; coef: number }[]
 *         intercept:   number
 *         r2:          number
 *         n:           number
 *       }
 *       warnings:    string[]
 *     }
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
})

// 有効観測数の最小閾値
const MIN_OBS = 10

// ── 数学ユーティリティ ──────────────────────────────────────────────────────────

/** Pearson 相関係数（有効な観測のみ使用） */
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

/**
 * OLS 最小二乗回帰: Y = b0 + b1*X1 + ... + bk*Xk
 * リストワイズ削除（Y または任意 X が null の行を除外）
 * 小規模向け Gauss-Jordan 逆行列で実装。
 */
function ols(
  Y: (number | null)[],
  Xs: (number | null)[][],
  featureLabels: string[],
): { intercept: number; coefficients: { label: string; coef: number }[]; r2: number; n: number } | null {
  // リストワイズ削除
  const rows: { y: number; xs: number[] }[] = []
  for (let i = 0; i < Y.length; i++) {
    if (Y[i] == null) continue
    const xRow = Xs.map(col => col[i])
    if (xRow.some(v => v == null)) continue
    rows.push({ y: Y[i]!, xs: xRow as number[] })
  }

  const n = rows.length
  const k = featureLabels.length  // 説明変数の数
  if (n < MIN_OBS || n <= k + 1) return null

  // 計画行列 X̃: n × (k+1)  (先頭列 = 1, 定数項)
  const Xt: number[][] = rows.map(r => [1, ...r.xs])
  const yVec: number[] = rows.map(r => r.y)

  // XᵀX: (k+1) × (k+1)
  const m = k + 1
  const XtX: number[][] = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (_, j) =>
      rows.reduce((s, _, r) => s + Xt[r][i] * Xt[r][j], 0)
    )
  )
  // Xᵀy: (k+1)
  const Xty: number[] = Array.from({ length: m }, (_, i) => {
    let s = 0
    for (let r = 0; r < rows.length; r++) {
      s += Xt[r][i] * rows[r].y
    }
    return s
  })

  // Gauss-Jordan 逆行列
  const inv = invertMatrix(XtX)
  if (!inv) return null

  // β = (XᵀX)⁻¹ Xᵀy
  const beta: number[] = Array.from({ length: m }, (_, i) =>
    inv[i].reduce((s, v, j) => s + v * Xty[j], 0)
  )

  // R²
  const yMean = yVec.reduce((s, v) => s + v, 0) / n
  const ssTot = yVec.reduce((s, v) => s + (v - yMean) ** 2, 0)
  let ssRes = 0
  for (let r = 0; r < rows.length; r++) {
    let yHat = 0
    for (let j = 0; j < beta.length; j++) {
      yHat += beta[j] * Xt[r][j]
    }
    ssRes += (rows[r].y - yHat) ** 2
  }
  const r2 = ssTot === 0 ? 0 : Math.round((1 - ssRes / ssTot) * 10000) / 10000

  return {
    intercept: Math.round(beta[0] * 10000) / 10000,
    coefficients: featureLabels.map((label, i) => ({
      label,
      coef: Math.round(beta[i + 1] * 10000) / 10000,
    })),
    r2,
    n,
  }
}

/** Gauss-Jordan 法による正方行列の逆行列（失敗時 null）*/
function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length
  // 拡大行列 [A | I] を作成
  const M: number[][] = A.map((row, i) =>
    [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]
  )
  for (let col = 0; col < n; col++) {
    // ピボット選択
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row
    }
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    if (Math.abs(M[col][col]) < 1e-12) return null  // 特異行列

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

// ── ワイド表構築 ──────────────────────────────────────────────────────────────

/**
 * project_metrics_daily からワイド表（日付 × 指標）を構築する。
 * timeUnit が 'week' / 'month' の場合は集計する。
 */
async function buildWideTable(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  allRefs: string[],
  startDate: string,
  endDate: string,
  timeUnit: 'day' | 'week' | 'month',
): Promise<{ table: Record<string, Record<string, number | null>>; warnings: string[] }> {
  const warnings: string[] = []

  function isExternalRef(colKey: string): boolean {
    return colKey.startsWith('external.')
  }

  function externalField(colKey: string): string | null {
    if (!isExternalRef(colKey)) return null
    return colKey.slice('external.'.length)
  }

  function aggregationMode(colKey: string): 'sum' | 'avg' | 'last' {
    // colKey は "{serviceId}::{metricRef}" または "external.xxx"
    const metricRef = colKey.includes('::') ? colKey.split('::').slice(1).join('::') : colKey
    const m = metricRef.toLowerCase()

    // 比率系は平均
    if (m.includes('rate') || m.includes('ctr') || m.includes('ratio')) return 'avg'
    // 時間（秒）などは平均
    if (m.includes('seconds') || m.includes('duration')) return 'avg'
    // 温度・降水など外生は平均（is_holiday は last）
    if (m.startsWith('external.')) {
      if (m === 'external.is_holiday') return 'last'
      return 'avg'
    }
    // スナップショット系（週次で足し上げると意味が崩れる）
    if (m.includes('follower_count') || m.includes('contacts')) return 'last'

    // デフォルトは合計（費用・表示・クリック・CV・売上など）
    return 'sum'
  }

  // service_id → metric_ref の分解（colKey = "serviceId::metricRef"）
  const refParsed = allRefs.map(ref => {
    const sep = ref.indexOf('::')
    if (sep < 0) return { colKey: ref, serviceId: null as string | null, metricRef: ref }
    return {
      colKey: ref,
      serviceId: ref.slice(0, sep),
      metricRef: ref.slice(sep + 2),
    }
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

  // date → colKey → value の raw マップ
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

  // 外生変数（project_external_daily）を rawMap にマージ
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
          if (f === 'is_holiday') {
            // boolean → 0/1
            v = (r.is_holiday as boolean | null) == null ? null : ((r.is_holiday as boolean) ? 1 : 0)
          } else if (f === 'temperature_max') {
            v = (r.temperature_max as number | null) ?? null
          } else if (f === 'temperature_min') {
            v = (r.temperature_min as number | null) ?? null
          } else if (f === 'precipitation_mm') {
            v = (r.precipitation_mm as number | null) ?? null
          } else if (f === 'weather_code') {
            v = (r.weather_code as number | null) ?? null
          }
          rawMap[dateStr][colKey] = v
        }
      }
    }
  }

  if (timeUnit === 'day') return { table: rawMap, warnings }

  // week / month 集計（指標ごとに sum / avg / last を使い分け）
  const grouped: Record<string, {
    sums: Record<string, number>
    counts: Record<string, number>
    last: Record<string, { date: string; value: number }>
  }> = {}

  const modes = Object.fromEntries(allRefs.map(ref => [ref, aggregationMode(ref)])) as Record<string, 'sum' | 'avg' | 'last'>
  const modeSummary = {
    sum: allRefs.filter(r => modes[r] === 'sum').length,
    avg: allRefs.filter(r => modes[r] === 'avg').length,
    last: allRefs.filter(r => modes[r] === 'last').length,
  }
  warnings.push(`週次/月次の集計は簡易ルールで実施（sum:${modeSummary.sum}, avg:${modeSummary.avg}, last:${modeSummary.last}）`)

  for (const [dateStr, values] of Object.entries(rawMap)) {
    const d = new Date(dateStr)
    let bucketKey: string
    if (timeUnit === 'week') {
      const mon = new Date(d)
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))  // 月曜始まり
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

  const { targetMetricRef, featureMetricRefs, startDate, endDate, timeUnit } = parsed.data
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

  // 観測数チェック
  if (dates.length < MIN_OBS) {
    warnings.push(
      `有効な観測数が ${dates.length} 件です（推奨: ${MIN_OBS} 件以上）。結果の信頼性が低い可能性があります。`,
    )
  }

  // ── 配列化 ───────────────────────────────────────────────────────────────────
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

  // ── 回帰 ─────────────────────────────────────────────────────────────────────
  let regression = null
  if (featureMetricRefs.length > 0) {
    const Xs = featureMetricRefs.map(ref => colVectors[ref])
    const result = ols(colVectors[targetMetricRef], Xs, featureMetricRefs)
    if (result) {
      regression = {
        target:   targetMetricRef,
        features: featureMetricRefs,
        ...result,
      }
    } else {
      warnings.push(
        `回帰を実行できませんでした（有効観測数不足、または多重共線性の可能性があります）。`,
      )
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      wideTable,
      columns:     allRefs,
      correlation,
      regression,
      warnings,
    },
  })
}
