/**
 * 投稿インサイトの時系列グラフ用（公開からの経過時間・フェーズ帯・累積/増分）
 */

import type { IgMedia } from '@/types'

export type InsightFactRow = {
  media_id?: string
  metric_code: string
  snapshot_at: string
  value: number | null
}

/** ig_media_insight_fact の行から時系列マップを組み立て（時刻昇順） */
export function buildTimeSeriesMapFromFactRows(
  rows: InsightFactRow[]
): Record<string, Array<{ snapshot_at: string; value: number | null }>> {
  const timeSeriesMap: Record<string, Array<{ snapshot_at: string; value: number | null }>> = {}
  for (const row of rows) {
    if (!timeSeriesMap[row.metric_code]) {
      timeSeriesMap[row.metric_code] = []
    }
    timeSeriesMap[row.metric_code].push({ snapshot_at: row.snapshot_at, value: row.value })
  }
  for (const k of Object.keys(timeSeriesMap)) {
    timeSeriesMap[k].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at))
  }
  return timeSeriesMap
}

export function groupInsightFactsByMedia(
  rows: Array<{ media_id: string; metric_code: string; snapshot_at: string; value: number | null }>
): Record<string, Record<string, Array<{ snapshot_at: string; value: number | null }>>> {
  const byMedia: Record<string, InsightFactRow[]> = {}
  for (const r of rows) {
    if (!byMedia[r.media_id]) byMedia[r.media_id] = []
    byMedia[r.media_id].push({
      metric_code: r.metric_code,
      snapshot_at: r.snapshot_at,
      value: r.value,
    })
  }
  const out: Record<string, Record<string, Array<{ snapshot_at: string; value: number | null }>>> = {}
  for (const mediaId of Object.keys(byMedia)) {
    out[mediaId] = buildTimeSeriesMapFromFactRows(byMedia[mediaId])
  }
  return out
}

/** 類似候補の並べ替え用（同じ media_product_type を優先） */
export function sortSimilarCandidates<T extends Pick<IgMedia, 'media_product_type' | 'media_type'>>(
  base: Pick<IgMedia, 'media_product_type' | 'media_type'>,
  rows: T[]
): T[] {
  const baseKey = base.media_product_type ?? base.media_type
  const same = rows.filter(r => (r.media_product_type ?? r.media_type) === baseKey)
  const other = rows.filter(r => !same.includes(r))
  return [...same, ...other]
}

export type InsightPhaseId = '0-6h' | '0-24h' | '0-72h' | '72h-7d' | '7d-30d' | 'all'

export type InsightValueMode = 'cumulative' | 'incremental'

export const INSIGHT_PHASE_OPTIONS: { id: InsightPhaseId; label: string; description: string }[] = [
  { id: '0-6h', label: '0〜6h', description: '直後の初速' },
  { id: '0-24h', label: '0〜24h', description: '初日' },
  { id: '0-72h', label: '0〜72h', description: '初速〜3日' },
  { id: '72h-7d', label: '72h〜7日', description: '翌週の伸び' },
  { id: '7d-30d', label: '7〜30日', description: '中長期' },
  { id: 'all', label: 'すべて', description: '取得分の全域' },
]

/** ストーリー（24h 寿命）向け: 長期フェーズは省く */
export const INSIGHT_PHASE_OPTIONS_STORY: { id: InsightPhaseId; label: string; description: string }[] = [
  { id: '0-6h', label: '0〜6h', description: '直後の初速' },
  { id: '0-24h', label: '0〜24h', description: '公開から24時間以内' },
  { id: 'all', label: 'すべて', description: '取得分の全域' },
]

const MS_H = 3600000
const MS_D = 86400000

/** 公開からの経過（ms）が [minMs, maxMs] に入るスナップのみ。all のときは null */
export function phaseElapsedBounds(phase: InsightPhaseId): { minMs: number; maxMs: number } | null {
  switch (phase) {
    case '0-6h':
      return { minMs: 0, maxMs: 6 * MS_H }
    case '0-24h':
      return { minMs: 0, maxMs: 24 * MS_H }
    case '0-72h':
      return { minMs: 0, maxMs: 72 * MS_H }
    case '72h-7d':
      return { minMs: 72 * MS_H, maxMs: 7 * MS_D }
    case '7d-30d':
      return { minMs: 7 * MS_D, maxMs: 30 * MS_D }
    case 'all':
      return null
    default:
      return null
  }
}

export type InsightPoint = { t: number; snapshot_at: string; value: number | null }

export function metricSeriesAsc(
  timeSeries: Record<string, Array<{ snapshot_at: string; value: number | null }>>,
  metric: string
): InsightPoint[] {
  const rows = timeSeries[metric] ?? []
  /** 同一時刻の複数行は後勝ち（ストーリー hourly と media 系のマージで重複し得る） */
  const byT = new Map<number, InsightPoint>()
  for (const r of rows) {
    const t = new Date(r.snapshot_at).getTime()
    if (Number.isNaN(t)) continue
    byT.set(t, { t, snapshot_at: r.snapshot_at, value: r.value })
  }
  return Array.from(byT.values()).sort((a, b) => a.t - b.t)
}

/** 時刻 deadline の直前（含む）のスナップショット値 */
export function valueAtOrBefore(series: InsightPoint[], deadlineMs: number): number | null {
  let best: number | null = null
  for (const p of series) {
    if (p.t > deadlineMs) break
    if (p.value != null) best = p.value
  }
  return best
}

export function formatElapsedJa(elapsedMs: number): string {
  if (elapsedMs < MS_H) return `${Math.round(elapsedMs / 60000)}分`
  if (elapsedMs < MS_D) return `${(elapsedMs / MS_H).toFixed(1)}h`.replace('.0h', 'h')
  const d = Math.floor(elapsedMs / MS_D)
  const h = Math.round((elapsedMs % MS_D) / MS_H)
  if (h === 0) return `${d}日`
  return `${d}日${h}h`
}

export type ChartRow = Record<string, string | number | null> & {
  snapshot_at: string
  elapsed_hours: number
  elapsed_label: string
}

/**
 * グラフ用データ。Instagram のスナップショット値は累積（その時点の合計）前提。
 * incremental: 前スナップとの差分。ウィンドウ先頭は「ウィンドウ直前の最終値」があればそれとの差。
 */
export function buildPostInsightChartRows(options: {
  postedAtIso: string
  timeSeries: Record<string, Array<{ snapshot_at: string; value: number | null }>>
  metrics: string[]
  phase: InsightPhaseId
  mode: InsightValueMode
}): ChartRow[] {
  const postedMs = new Date(options.postedAtIso).getTime()
  if (Number.isNaN(postedMs)) return []

  const bounds = phaseElapsedBounds(options.phase)
  const perMetric = new Map<string, InsightPoint[]>()
  for (const m of options.metrics) {
    perMetric.set(m, metricSeriesAsc(options.timeSeries, m))
  }

  const snapTimes = new Set<number>()
  for (const m of options.metrics) {
    for (const p of perMetric.get(m) ?? []) snapTimes.add(p.t)
  }
  const sortedT = Array.from(snapTimes).sort((a, b) => a - b)

  const inPhase = (t: number) => {
    const elapsed = t - postedMs
    if (elapsed < 0) return false
    if (!bounds) return true
    return elapsed >= bounds.minMs && elapsed <= bounds.maxMs
  }

  const filteredT = sortedT.filter(inPhase)
  if (filteredT.length === 0) return []

  const rows: ChartRow[] = []

  for (let i = 0; i < filteredT.length; i++) {
    const t = filteredT[i]
    const elapsed = t - postedMs
    const row: ChartRow = {
      snapshot_at: new Date(t).toISOString(),
      elapsed_hours: Math.round(elapsed / MS_H * 10) / 10,
      elapsed_label: formatElapsedJa(elapsed),
      time: `${formatElapsedJa(elapsed)}（${new Date(t).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）`,
    }

    for (const m of options.metrics) {
      const series = perMetric.get(m) ?? []
      const atT = series.find(p => p.t === t)?.value ?? null

      if (options.mode === 'cumulative') {
        row[m] = atT
        continue
      }

      // incremental
      let prevVal: number | null = null
      if (i > 0) {
        const prevT = filteredT[i - 1]
        prevVal = series.find(p => p.t === prevT)?.value ?? null
      } else {
        // ウィンドウ開始直前の累積（例: 72h〜7日なら「72h時点まで」の最新値）
        let deadline: number
        if (bounds && bounds.minMs > 0) {
          deadline = postedMs + bounds.minMs
        } else {
          deadline = postedMs - 1
        }
        prevVal = valueAtOrBefore(series, deadline)
      }

      if (atT == null) {
        row[m] = null
      } else if (prevVal == null) {
        row[m] = atT
      } else {
        row[m] = atT - prevVal
      }
    }
    rows.push(row)
  }

  return rows
}

export type MilestoneId = '6h' | '24h' | '72h' | '7d'

export const INSIGHT_MILESTONES: { id: MilestoneId; label: string; ms: number }[] = [
  { id: '6h', label: '公開後6h', ms: 6 * MS_H },
  { id: '24h', label: '公開後24h', ms: 24 * MS_H },
  { id: '72h', label: '公開後72h', ms: 72 * MS_H },
  { id: '7d', label: '公開後7日', ms: 7 * MS_D },
]

/** ストーリー向け（公開から24時間以内が主） */
export const INSIGHT_MILESTONES_STORY: { id: MilestoneId; label: string; ms: number }[] = [
  { id: '6h', label: '公開後6h', ms: 6 * MS_H },
  { id: '24h', label: '公開後24h', ms: 24 * MS_H },
]

/** 各マイルストーン時点の累積値（その時刻以前の最新スナップ） */
export function milestoneCumulativeSummary(
  postedAtIso: string,
  timeSeries: Record<string, Array<{ snapshot_at: string; value: number | null }>>,
  metricCodes: string[],
  milestones: { id: MilestoneId; label: string; ms: number }[] = INSIGHT_MILESTONES
): Record<MilestoneId, Record<string, number | null>> {
  const postedMs = new Date(postedAtIso).getTime()
  const out: Record<MilestoneId, Record<string, number | null>> = {
    '6h': {},
    '24h': {},
    '72h': {},
    '7d': {},
  }
  if (Number.isNaN(postedMs)) {
    for (const ms of milestones) {
      for (const m of metricCodes) out[ms.id][m] = null
    }
    return out
  }

  for (const ms of milestones) {
    const deadline = postedMs + ms.ms
    for (const m of metricCodes) {
      const series = metricSeriesAsc(timeSeries, m)
      out[ms.id][m] = valueAtOrBefore(series, deadline)
    }
  }
  return out
}

/** 類似投稿オーバーレイ用（公開からの経過を 1h 刻みで揃える） */
export type OverlaySeriesPost = {
  id: string
  label: string
  postedAtIso: string
  timeSeries: Record<string, Array<{ snapshot_at: string; value: number | null }>>
}

export type OverlayHourlyRow = {
  elapsed_hours: number
  elapsed_label: string
  time: string
} & Record<string, number | null>

/** dataKey は `s_${postId}`（累積） */
export function buildOverlayCumulativeHourlyRows(
  posts: OverlaySeriesPost[],
  metric: string,
  maxElapsedHours: number
): OverlayHourlyRow[] {
  if (posts.length === 0 || maxElapsedHours < 0) return []
  const rows: OverlayHourlyRow[] = []
  for (let h = 0; h <= maxElapsedHours; h++) {
    const elapsedMs = h * MS_H
    const row: OverlayHourlyRow = {
      elapsed_hours: h,
      elapsed_label: h === 0 ? '0h' : `${h}h`,
      time: `公開から約 ${h}h`,
    }
    for (const p of posts) {
      const postedMs = new Date(p.postedAtIso).getTime()
      if (Number.isNaN(postedMs)) {
        row[`s_${p.id}`] = null
        continue
      }
      const series = metricSeriesAsc(p.timeSeries, metric)
      row[`s_${p.id}`] = valueAtOrBefore(series, postedMs + elapsedMs)
    }
    rows.push(row)
  }
  return rows
}

export type MilestoneDiffRow = {
  milestoneLabel: string
  milestoneId: MilestoneId
  metric: string
  main: number | null
  peer: number | null
  delta: number | null
  deltaPct: number | null
  peerLabel: string
}

/** メイン vs 1件のピアで、マイルストーンごとの差分（累積） */
export function buildMilestoneDiffTable(
  main: OverlaySeriesPost,
  peer: OverlaySeriesPost,
  metrics: string[],
  milestones: { id: MilestoneId; label: string; ms: number }[] = INSIGHT_MILESTONES
): MilestoneDiffRow[] {
  const mainMs = milestoneCumulativeSummary(main.postedAtIso, main.timeSeries, metrics, milestones)
  const peerMs = milestoneCumulativeSummary(peer.postedAtIso, peer.timeSeries, metrics, milestones)
  const out: MilestoneDiffRow[] = []
  for (const ms of milestones) {
    for (const m of metrics) {
      const mv = mainMs[ms.id][m] ?? null
      const pv = peerMs[ms.id][m] ?? null
      let delta: number | null = null
      let deltaPct: number | null = null
      if (mv != null && pv != null) {
        delta = mv - pv
        deltaPct = pv !== 0 ? (delta / Math.abs(pv)) * 100 : null
      }
      out.push({
        milestoneLabel: ms.label,
        milestoneId: ms.id,
        metric: m,
        main: mv,
        peer: pv,
        delta,
        deltaPct,
        peerLabel: peer.label,
      })
    }
  }
  return out
}
