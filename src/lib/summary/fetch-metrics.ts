/**
 * サービス別指標取得関数（共有ライブラリ）
 *
 * このファイルの関数は以下から利用される:
 *   - /api/services/[serviceId]/summary/data (サービス単体サマリー)
 *   - /api/projects/[projectId]/unified-summary (プロジェクト横断サマリー)
 */

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { generateCustomRangePeriod, generateJstDayPeriods, generateJstDayPeriodsFromRange } from '@/lib/summary/jst-periods'
import { salesHourlySlotsForRevenueSumByDay } from '@/lib/summary/sales-slot-aggregate'

export type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
export type TimeUnit = 'hour' | 'day' | 'week' | 'month' | 'custom_range'

export interface Period {
  label: string
  start: Date
  end: Date
  /** 日次（JST）のとき DB の value_date と突き合わせる YYYY-MM-DD */
  dateKey?: string
  /** custom_range のとき含む日付境界 YYYY-MM-DD */
  rangeStart?: string
  rangeEnd?: string
}

// ── 期間生成 ────────────────────────────────────────────────────────────────

function generatePeriods(unit: TimeUnit, count: number): Period[] {
  const periods: Period[] = []
  const now = new Date()

  if (unit === 'day') {
    return generateJstDayPeriods(count, now)
  }

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    let start: Date, end: Date, label: string

    switch (unit) {
      case 'hour': {
        d.setHours(d.getHours() - i, 0, 0, 0)
        start = new Date(d)
        end = new Date(d); end.setHours(end.getHours() + 1)
        label = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`
        break
      }
      case 'week': {
        // 既存仕様: 「直近N週間」表現。週の境界は range 指定のときに ISO週へ揃える。
        d.setDate(d.getDate() - i * 7)
        d.setHours(0, 0, 0, 0)
        start = new Date(d)
        end = new Date(d); end.setDate(end.getDate() + 7)
        label = `${d.getMonth() + 1}/${d.getDate()}週`
        break
      }
      case 'month': {
        d.setMonth(d.getMonth() - i)
        d.setDate(1); d.setHours(0, 0, 0, 0)
        start = new Date(d)
        end = new Date(d); end.setMonth(end.getMonth() + 1)
        label = `${d.getFullYear()}/${d.getMonth() + 1}`
        break
      }
      default: {
        start = new Date(d)
        end = new Date(d)
        label = ''
      }
    }
    periods.push({ label, start: start!, end: end! })
  }
  return periods
}

export function buildPeriods(
  unit: TimeUnit,
  count: number,
  rangeStartParam?: string | null,
  rangeEndParam?: string | null,
): Period[] | { error: string } {
  if (unit === 'custom_range') {
    if (!rangeStartParam || !rangeEndParam || rangeStartParam > rangeEndParam) {
      return { error: 'custom_range には rangeStart・rangeEnd（YYYY-MM-DD）が必要です' }
    }
    const cr = generateCustomRangePeriod(rangeStartParam, rangeEndParam)
    return [{ label: cr.label, start: cr.start, end: cr.end, rangeStart: cr.rangeStart, rangeEnd: cr.rangeEnd }]
  }

  // day/week/month の場合も、rangeStart/rangeEnd が指定されていれば範囲から periods を生成する。
  // 目的: 分析画面などで YYYY-MM-DD~YYYY-MM-DD の範囲指定を可能にする。
  if (rangeStartParam && rangeEndParam) {
    const rs = rangeStartParam.slice(0, 10)
    const re = rangeEndParam.slice(0, 10)
    if (rs > re) return { error: 'rangeStart は rangeEnd 以下である必要があります' }

    if (unit === 'day') {
      return generateJstDayPeriodsFromRange(rs, re)
    }

    if (unit === 'week') {
      // ISO週（月曜開始）で範囲を区切る。部分週も含める（range にかかる週は全部出す）。
      const periods: Period[] = []
      const startDate = new Date(`${rs}T12:00:00+09:00`)
      const endDate = new Date(`${re}T12:00:00+09:00`)

      // 月曜開始へ寄せる
      const day = (startDate.getDay() + 6) % 7 // Mon=0 ... Sun=6
      const monday = new Date(startDate)
      monday.setDate(monday.getDate() - day)
      monday.setHours(0, 0, 0, 0)

      let cur = monday
      while (cur <= endDate) {
        const start = new Date(cur)
        const end = new Date(cur); end.setDate(end.getDate() + 7)
        const label = `${start.getMonth() + 1}/${start.getDate()}週`
        periods.push({ label, start, end })
        cur = new Date(cur); cur.setDate(cur.getDate() + 7)
      }
      return periods
    }

    if (unit === 'month') {
      // 暦月で範囲を区切る。部分月も含める。
      const periods: Period[] = []
      const startDate = new Date(`${rs}T12:00:00+09:00`)
      const endDate = new Date(`${re}T12:00:00+09:00`)

      const cur = new Date(startDate)
      cur.setDate(1); cur.setHours(0, 0, 0, 0)

      while (cur <= endDate) {
        const start = new Date(cur)
        const end = new Date(cur); end.setMonth(end.getMonth() + 1)
        const label = `${start.getFullYear()}/${start.getMonth() + 1}`
        periods.push({ label, start, end })
        cur.setMonth(cur.getMonth() + 1)
      }
      return periods
    }
  }

  return generatePeriods(unit, count)
}

// ── 内部ユーティリティ ───────────────────────────────────────────────────────

/** 日付を対応する期間ラベルに変換 */
export function bucketDate(d: Date, periods: Period[]): string | null {
  for (const p of periods) {
    if (d >= p.start && d < p.end) return p.label
  }
  return null
}

/** 空の集計マップを生成 */
function emptyAccum(periods: Period[]): Record<string, { sum: number; count: number } | null> {
  return Object.fromEntries(periods.map(p => [p.label, null]))
}

/** 集計マップを { label: value | null } に変換 */
function finalizeAccum(
  accum: Record<string, { sum: number; count: number } | null>,
  mode: 'sum' | 'avg',
): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(accum).map(([label, v]) => {
      if (!v) return [label, null]
      return [label, mode === 'avg' ? Math.round((v.sum / v.count) * 100) / 100 : v.sum]
    }),
  )
}

/** accum に値を加算 */
function addValue(
  accum: Record<string, { sum: number; count: number } | null>,
  label: string | null,
  value: number | null | undefined,
) {
  if (!label || value == null) return
  const cur = accum[label]
  accum[label] = cur
    ? { sum: cur.sum + value, count: cur.count + 1 }
    : { sum: value, count: 1 }
}

// AVG で集計するフィールド
export const AVG_FIELDS = new Set([
  'avg_stay_seconds', 'session_intent_score', 'duration_seconds',
  'interaction_count', 'scroll_percent_max', 'stay_seconds',
  'percentage', 'intent_score',
])

// ── テーブルごとのクエリハンドラ ─────────────────────────────────────────────

/**
 * ig_account_insight_fact
 * pivot: metric_code = field, value_date DATE
 */
export async function fetchIgAccountInsight(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  type IgAccountInsightSpec = {
    /** fetchMetricsByRefs の返却キー（= 元の fieldRef の table 以降） */
    refKey: string
    metric_code: string
    dimension_code: string
    dimension_value: string
    period_code: 'day' | 'lifetime'
  }

  const parseIgAccountInsightSpec = (rawField: string, refKey: string): IgAccountInsightSpec => {
    // 例:
    // - reach                              => 合計（dimension 空）/ day
    // - reach@@media_product_type=REELS    => breakdown 行 / day
    // - views@@follower_type=FOLLOWER      => breakdown 行 / day
    // - engaged_audience_demographics@@dimension_code=country@@dimension_value=US@@period=lifetime
    const parts = rawField.split('@@').map(s => s.trim()).filter(Boolean)
    let metric_code = parts[0] && !parts[0].includes('=') ? parts[0] : ''
    const kv: Record<string, string> = {}
    for (const p of parts) {
      if (!p.includes('=')) {
        if (!metric_code) metric_code = p
        continue
      }
      const idx = p.indexOf('=')
      const k = p.slice(0, idx).trim()
      const v = p.slice(idx + 1).trim()
      if (k) kv[k] = v
    }
    if (!metric_code) metric_code = rawField

    const periodRaw = (kv.period ?? 'day').toLowerCase()
    const period_code: 'day' | 'lifetime' = periodRaw === 'lifetime' ? 'lifetime' : 'day'

    const dimension_code = kv.dimension_code ?? kv.dc ?? ''
    const dimension_value = kv.dimension_value ?? kv.dv ?? ''

    // 互換: reach@@media_product_type=REELS のような “breakdownKey=value” を dimension に正規化
    let dimCode = dimension_code
    let dimVal = dimension_value
    if (!dimCode) {
      const breakdownKeys = new Set(['media_product_type', 'follow_type', 'follower_type', 'country', 'age', 'gender', 'city'])
      for (const [k, v] of Object.entries(kv)) {
        if (breakdownKeys.has(k)) {
          dimCode = k
          dimVal = v
          break
        }
      }
    }

    return {
      refKey,
      metric_code,
      dimension_code: dimCode,
      dimension_value: dimVal,
      period_code,
    }
  }

  const { data: igRow } = await supabase
    .from('ig_accounts')
    .select('id')
    .eq('service_id', serviceId)
    .maybeSingle()
  if (!igRow) return result

  const accountId = igRow.id
  const p0 = periods[0]
  const pLast = periods[periods.length - 1]
  let rangeStart: string
  let rangeEnd: string
  if (periods.length === 1 && p0.rangeStart && p0.rangeEnd) {
    rangeStart = p0.rangeStart
    rangeEnd = p0.rangeEnd
  } else {
    const dayKeys = periods.map(p => p.dateKey).filter((k): k is string => Boolean(k))
    rangeStart =
      dayKeys.length === periods.length && dayKeys.length > 0
        ? [...dayKeys].sort()[0]
        : p0.start.toISOString().slice(0, 10)
    rangeEnd =
      dayKeys.length === periods.length && dayKeys.length > 0
        ? [...dayKeys].sort()[dayKeys.length - 1]
        : pLast.end.toISOString().slice(0, 10)
  }

  for (const field of fields) {
    const spec = parseIgAccountInsightSpec(field, field)
    const accum = emptyAccum(periods)

    if (spec.period_code === 'lifetime') {
      // lifetime は「最新スナップショット1件」を期間全体に割り当てる（短いレンジでも欠損しにくい）
      let q = supabase
        .from('ig_account_insight_fact')
        .select('value_date, value')
        .eq('account_id', accountId)
        .eq('metric_code', spec.metric_code)
        .eq('period_code', 'lifetime')

      if (spec.dimension_code) q = q.eq('dimension_code', spec.dimension_code)
      else q = q.eq('dimension_code', '')
      if (spec.dimension_value) q = q.eq('dimension_value', spec.dimension_value)
      else q = q.eq('dimension_value', '')

      const { data: row } = await q.order('value_date', { ascending: false }).limit(1).maybeSingle()
      const v = row?.value
      if (v != null) {
        for (const p of periods) {
          addValue(accum, p.label, v as number)
        }
      }
      result[`ig_account_insight_fact.${spec.refKey}`] = finalizeAccum(accum, 'sum')
      continue
    }

    let q = supabase
      .from('ig_account_insight_fact')
      .select('value_date, value')
      .eq('account_id', accountId)
      .eq('metric_code', spec.metric_code)
      .eq('period_code', 'day')

    if (spec.dimension_code) q = q.eq('dimension_code', spec.dimension_code)
    else q = q.eq('dimension_code', '')
    if (spec.dimension_value) q = q.eq('dimension_value', spec.dimension_value)
    else q = q.eq('dimension_value', '')

    q = q.gte('value_date', rangeStart).lte('value_date', rangeEnd)

    const { data: rows } = await q

    for (const row of rows ?? []) {
      const vd = String(row.value_date).slice(0, 10)
      let label: string | null = null
      if (periods.length === 1 && p0.rangeStart && p0.rangeEnd) {
        if (vd >= p0.rangeStart && vd <= p0.rangeEnd) label = p0.label
      } else {
        const byKey = periods.find(p => p.dateKey === vd)?.label
        label =
          byKey ??
          bucketDate(new Date(`${vd}T12:00:00+09:00`), periods)
      }
      addValue(accum, label, row.value)
    }
    result[`ig_account_insight_fact.${spec.refKey}`] = finalizeAccum(accum, 'sum')
  }
  return result
}

type IgMediaInsightLogicalTable =
  | 'ig_media_insight_feed'
  | 'ig_media_insight_reels'
  | 'ig_media_insight_story'

/**
 * ig_media_insight_feed / reels / story
 * → DB は ig_media_insight_fact（種別は ig_media で絞る）
 */
export async function fetchIgMediaInsightByProduct(
  supabase: SupabaseServerClient,
  serviceId: string,
  logicalTable: IgMediaInsightLogicalTable,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}
  const fieldUniq = [...new Set(fields)]

  const metricCodesForField = (field: string): string[] => {
    if (field.startsWith('profile_activity_')) return [field]
    if (field.startsWith('navigation_')) return [field]
    return [field, `profile_activity_${field}`]
  }

  const fillAllNull = () => {
    for (const f of fieldUniq) {
      result[`${logicalTable}.${f}`] = Object.fromEntries(periods.map(p => [p.label, null]))
    }
    return result
  }

  const { data: igRow } = await supabase
    .from('ig_accounts')
    .select('id')
    .eq('service_id', serviceId)
    .maybeSingle()
  if (!igRow) return fillAllNull()

  let mediaQuery = supabase
    .from('ig_media')
    .select('id')
    .eq('account_id', igRow.id)
    .eq('is_deleted', false)

  if (logicalTable === 'ig_media_insight_feed') {
    mediaQuery = mediaQuery.eq('media_product_type', 'FEED')
  } else if (logicalTable === 'ig_media_insight_story') {
    mediaQuery = mediaQuery.eq('media_product_type', 'STORY')
  } else {
    mediaQuery = mediaQuery.or('media_product_type.eq.REELS,media_type.eq.VIDEO')
  }

  const { data: mediaRows } = await mediaQuery
  const mediaIds = (mediaRows ?? []).map(m => m.id)
  if (mediaIds.length === 0) return fillAllNull()

  const rangeEndIso = periods[periods.length - 1].end.toISOString()
  const allFacts: Array<{
    media_id: string
    metric_code: string
    value: number | null
    snapshot_at: string
  }> = []
  const pageSize = 1000
  const metricCodes = [...new Set(fieldUniq.flatMap(metricCodesForField))]
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from('ig_media_insight_fact')
      .select('media_id, metric_code, value, snapshot_at')
      .in('media_id', mediaIds)
      .in('metric_code', metricCodes)
      .lt('snapshot_at', rangeEndIso)
      .order('snapshot_at', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) {
      console.error('[fetch-metrics] ig_media_insight_fact query failed', error)
      return fillAllNull()
    }
    const chunk = page ?? []
    allFacts.push(...chunk)
    if (chunk.length < pageSize) break
  }

  const timelines = new Map<string, { t: number; v: number }[]>()
  for (const row of allFacts) {
    if (row.value == null) continue
    const fieldForRow = (() => {
      if (fieldUniq.includes(row.metric_code)) return row.metric_code
      if (row.metric_code.startsWith('profile_activity_')) {
        const tail = row.metric_code.slice('profile_activity_'.length)
        if (fieldUniq.includes(tail)) return tail
      }
      return row.metric_code
    })()
    const k = `${row.media_id}\0${fieldForRow}`
    let arr = timelines.get(k)
    if (!arr) {
      arr = []
      timelines.set(k, arr)
    }
    arr.push({ t: new Date(row.snapshot_at).getTime(), v: Number(row.value) })
  }
  for (const arr of timelines.values()) {
    arr.sort((a, b) => a.t - b.t)
  }

  for (const field of fieldUniq) {
    const accum = emptyAccum(periods)
    for (const p of periods) {
      const endMs = p.end.getTime()
      let sum = 0
      let any = false
      for (const mid of mediaIds) {
        const arr = timelines.get(`${mid}\0${field}`)
        if (!arr?.length) continue
        let lo = 0
        let hi = arr.length - 1
        let ans = -1
        while (lo <= hi) {
          const m = (lo + hi) >> 1
          if (arr[m].t < endMs) {
            ans = m
            lo = m + 1
          } else {
            hi = m - 1
          }
        }
        if (ans >= 0) {
          sum += arr[ans].v
          any = true
        }
      }
      addValue(accum, p.label, any ? sum : undefined)
    }
    result[`${logicalTable}.${field}`] = finalizeAccum(accum, 'sum')
  }

  return result
}

const GOOGLE_ADS_SUM_METRICS = new Set([
  'impressions',
  'clicks',
  'cost_micros',
  'conversions',
  'conversion_value_micros',
])
const GOOGLE_ADS_DERIVED_METRICS = new Set(['ctr', 'average_cpc_micros'])
const GOOGLE_ADS_KEYWORD_ONLY = new Set(['quality_score'])

export type GoogleAdsDailyTable =
  | 'google_ads_campaign_daily'
  | 'google_ads_adgroup_daily'
  | 'google_ads_keyword_daily'

/**
 * Google 広告日次（キャンペーン／広告グループ／キーワード）を service_id で集計。
 * field 例: impressions | impressions@@campaign_id=123 | clicks@@ad_group_id=456 | cost_micros@@keyword_id=789
 * ctr / average_cpc_micros は期間内の合算クリック・インプレ・費用から算出する。
 */
export function parseGoogleAdsDailyField(
  raw: string,
  logicalTable: GoogleAdsDailyTable = 'google_ads_campaign_daily',
): {
  refKey: string
  dbTable: GoogleAdsDailyTable
  metric: string
  campaignId?: string
  adGroupId?: string
  keywordId?: string
} | null {
  const parts = raw.split('@@').map(s => s.trim()).filter(Boolean)
  const kv: Record<string, string> = {}
  for (const p of parts) {
    if (!p.includes('=')) continue
    const idx = p.indexOf('=')
    const k = p.slice(0, idx).trim()
    const v = p.slice(idx + 1).trim()
    if (k) kv[k] = v
  }
  const metric = (parts[0] && !parts[0].includes('=') ? parts[0] : '').trim()
  if (!metric) return null

  const keywordId = kv.keyword_id ?? kv.kw_id ?? ''
  const adGroupId = kv.ad_group_id ?? kv.adgroup_id ?? ''
  const campaignId = kv.campaign_id ?? ''

  let dbTable: GoogleAdsDailyTable
  if (keywordId) dbTable = 'google_ads_keyword_daily'
  else if (adGroupId) dbTable = 'google_ads_adgroup_daily'
  else dbTable = logicalTable

  if (GOOGLE_ADS_KEYWORD_ONLY.has(metric) && dbTable !== 'google_ads_keyword_daily') return null
  if (
    !GOOGLE_ADS_SUM_METRICS.has(metric) &&
    !GOOGLE_ADS_DERIVED_METRICS.has(metric) &&
    !GOOGLE_ADS_KEYWORD_ONLY.has(metric)
  ) {
    return null
  }

  return {
    refKey: raw,
    dbTable,
    metric,
    campaignId: campaignId || undefined,
    adGroupId: adGroupId || undefined,
    keywordId: keywordId || undefined,
  }
}

type GoogleAdsRoll = {
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversion_value_micros: number
  qualitySum: number
  qualityCnt: number
}

function emptyGoogleAdsRoll(): GoogleAdsRoll {
  return {
    impressions: 0,
    clicks: 0,
    cost_micros: 0,
    conversions: 0,
    conversion_value_micros: 0,
    qualitySum: 0,
    qualityCnt: 0,
  }
}

function refKeyForGoogleAdsSpec(
  logicalTable: GoogleAdsDailyTable,
  spec: NonNullable<ReturnType<typeof parseGoogleAdsDailyField>>,
): string {
  return `${logicalTable}.${spec.refKey}`
}

export async function fetchGoogleAdsDailyAggregate(
  supabase: SupabaseServerClient,
  serviceId: string,
  entries: Array<{ logicalTable: GoogleAdsDailyTable; field: string }>,
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}
  const nullRow = () => Object.fromEntries(periods.map((p) => [p.label, null] as const))

  const specs = entries
    .map(({ logicalTable, field }) => {
      const s = parseGoogleAdsDailyField(field, logicalTable)
      return s ? { logicalTable, spec: s } : null
    })
    .filter((x): x is { logicalTable: GoogleAdsDailyTable; spec: NonNullable<ReturnType<typeof parseGoogleAdsDailyField>> } => x != null)

  for (const { logicalTable, field } of entries) {
    result[`${logicalTable}.${field}`] = nullRow()
  }
  if (specs.length === 0) return result

  type GroupSpec = NonNullable<ReturnType<typeof parseGoogleAdsDailyField>>
  const groupKey = (s: GroupSpec) =>
    `${s.dbTable}\0${s.campaignId ?? ''}\0${s.adGroupId ?? ''}\0${s.keywordId ?? ''}`

  const uniqueGroups = new Map<string, GroupSpec>()
  for (const { spec: s } of specs) {
    const k = groupKey(s)
    if (!uniqueGroups.has(k)) uniqueGroups.set(k, s)
  }

  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd = periods[periods.length - 1].end.toISOString().slice(0, 10)

  const rollsByGroup = new Map<string, Map<string, GoogleAdsRoll>>()

  for (const spec of uniqueGroups.values()) {
    const gk = groupKey(spec)
    const selectCols =
      spec.dbTable === 'google_ads_keyword_daily'
        ? 'date, impressions, clicks, cost_micros, conversions, conversion_value_micros, quality_score'
        : 'date, impressions, clicks, cost_micros, conversions, conversion_value_micros'

    let q = supabase
      .from(spec.dbTable)
      .select(selectCols)
      .eq('service_id', serviceId)
      .gte('date', rangeStart)
      .lte('date', rangeEnd)
    if (spec.campaignId) q = q.eq('campaign_id', spec.campaignId)
    if (spec.adGroupId) q = q.eq('ad_group_id', spec.adGroupId)
    if (spec.keywordId) q = q.eq('keyword_id', spec.keywordId)

    const { data: rawRows, error } = await q
    if (error) {
      console.error('[fetch-metrics] google_ads daily query failed', { serviceId, table: spec.dbTable, error })
      rollsByGroup.set(gk, new Map())
      continue
    }

    const byLabel = new Map<string, GoogleAdsRoll>()
    for (const row of rawRows ?? []) {
      const label = bucketDate(new Date(`${String(row.date).slice(0, 10)}T12:00:00+09:00`), periods)
      if (!label) continue
      let roll = byLabel.get(label)
      if (!roll) {
        roll = emptyGoogleAdsRoll()
        byLabel.set(label, roll)
      }
      roll.impressions += Number(row.impressions ?? 0)
      roll.clicks += Number(row.clicks ?? 0)
      roll.cost_micros += Number(row.cost_micros ?? 0)
      roll.conversions += Number(row.conversions ?? 0)
      roll.conversion_value_micros += Number(row.conversion_value_micros ?? 0)
      if (spec.dbTable === 'google_ads_keyword_daily' && 'quality_score' in row) {
        const qs = (row as { quality_score?: unknown }).quality_score
        if (qs != null && Number.isFinite(Number(qs))) {
          roll.qualitySum += Number(qs)
          roll.qualityCnt += 1
        }
      }
    }
    rollsByGroup.set(gk, byLabel)
  }

  const metricValue = (metric: string, roll: GoogleAdsRoll): number | null => {
    const { impressions: imp, clicks: clk, cost_micros: cost, conversions: conv, conversion_value_micros: cv } =
      roll
    switch (metric) {
      case 'impressions':
        return imp
      case 'clicks':
        return clk
      case 'cost_micros':
        return cost
      case 'conversions':
        return conv
      case 'conversion_value_micros':
        return cv
      case 'ctr':
        return imp > 0 ? Math.round((clk / imp) * 1_000_000) / 1_000_000 : null
      case 'average_cpc_micros':
        return clk > 0 ? Math.round(cost / clk) : null
      case 'quality_score':
        return roll.qualityCnt > 0 ? Math.round((roll.qualitySum / roll.qualityCnt) * 100) / 100 : null
      default:
        return null
    }
  }

  for (const { logicalTable, spec } of specs) {
    const gk = groupKey(spec)
    const byLabel = rollsByGroup.get(gk) ?? new Map()
    const ref = refKeyForGoogleAdsSpec(logicalTable, spec)
    const out = nullRow()
    for (const p of periods) {
      const roll = byLabel.get(p.label)
      out[p.label] = roll ? metricValue(spec.metric, roll) : null
    }
    result[ref] = out
  }

  return result
}

/**
 * gbp_performance_daily
 * 直接カラム、date DATE
 */
export async function fetchGbpPerformance(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const { data: siteRow } = await supabase
    .from('gbp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()
  if (!siteRow) return result

  const siteId = siteRow.id
  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd   = periods[periods.length - 1].end.toISOString().slice(0, 10)
  const selectCols = ['date', ...fields].join(',')

  const { data: rawRows } = await supabase
    .from('gbp_performance_daily')
    .select(selectCols)
    .eq('gbp_site_id', siteId)
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
  const rows = (rawRows ?? []) as unknown as Record<string, unknown>[]

  for (const field of fields) {
    const accum = emptyAccum(periods)
    for (const row of rows) {
      const label = bucketDate(new Date(row.date as string), periods)
      addValue(accum, label, row[field] as number)
    }
    result[`gbp_performance_daily.${field}`] = finalizeAccum(accum, AVG_FIELDS.has(field) ? 'avg' : 'sum')
  }
  return result
}

/**
 * gbp_reviews
 * date軸: create_time TIMESTAMPTZ
 * star_rating は 'ONE'→1 … 'FIVE'→5 に変換して avg
 * テキスト系フィールド（comment, reviewer_name, reply_comment等）は non-null 件数を返す
 */
const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
}
export async function fetchGbpReviews(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const { data: siteRow } = await supabase
    .from('gbp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()
  if (!siteRow) return result

  const siteId = siteRow.id
  const rangeStart = periods[0].start.toISOString()
  const rangeEnd   = periods[periods.length - 1].end.toISOString()
  // create_time はカタログフィールドにも含まれるため Set で重複を排除
  const selectCols = [...new Set(['create_time', ...fields])].join(',')

  const { data: rawRows } = await supabase
    .from('gbp_reviews')
    .select(selectCols)
    .eq('gbp_site_id', siteId)
    .gte('create_time', rangeStart)
    .lte('create_time', rangeEnd)
  const rows = (rawRows ?? []) as unknown as Record<string, unknown>[]

  for (const field of fields) {
    const accum = emptyAccum(periods)
    for (const row of rows) {
      const label = bucketDate(new Date(row.create_time as string), periods)
      if (field === 'star_rating') {
        const num = STAR_RATING_MAP[row[field] as string] ?? null
        addValue(accum, label, num)
      } else {
        // テキスト系: non-null なら 1 としてカウント
        addValue(accum, label, row[field] != null ? 1 : null)
      }
    }
    // star_rating のみ平均、その他はカウント（sum）
    result[`gbp_reviews.${field}`] = finalizeAccum(accum, field === 'star_rating' ? 'avg' : 'sum')
  }
  return result
}

/**
 * gbp_review_star_counts_daily（レビュー投稿日 JST × 星別件数バッチ集計）
 */
export async function fetchGbpReviewStarCountsDaily(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const { data: siteRow } = await supabase
    .from('gbp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()
  if (!siteRow) return result

  const siteId = siteRow.id
  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd = periods[periods.length - 1].end.toISOString().slice(0, 10)
  const selectCols = ['date', ...fields].join(',')

  const { data: rawRows } = await supabase
    .from('gbp_review_star_counts_daily')
    .select(selectCols)
    .eq('gbp_site_id', siteId)
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
  const rows = (rawRows ?? []) as unknown as Record<string, unknown>[]

  for (const field of fields) {
    const accum = emptyAccum(periods)
    for (const row of rows) {
      const label = bucketDate(new Date(row.date as string), periods)
      addValue(accum, label, row[field] as number)
    }
    result[`gbp_review_star_counts_daily.${field}`] = finalizeAccum(accum, 'sum')
  }
  return result
}

/**
 * gbp_search_keyword_monthly
 * field 例: impressions@@search_keyword=pizza@@year=2025@@month=3
 * 暦月の期間バケットが完全一致するか、単一期間 custom_range がその月と重なる場合に値を入れる。
 */
export async function fetchGbpSearchKeywordMonthly(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const parseSpec = (
    raw: string,
  ): { refKey: string; searchKeyword: string; year: number; month: number } | null => {
    const parts = raw.split('@@').map(s => s.trim()).filter(Boolean)
    const kv: Record<string, string> = {}
    for (const p of parts) {
      if (!p.includes('=')) continue
      const idx = p.indexOf('=')
      const k = p.slice(0, idx).trim()
      const v = p.slice(idx + 1).trim()
      if (k) kv[k] = v
    }
    const sk = kv.search_keyword ?? kv.q ?? ''
    const year = parseInt(kv.year ?? '', 10)
    const month = parseInt(kv.month ?? '', 10)
    if (!sk || !Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
    return { refKey: raw, searchKeyword: sk, year, month }
  }

  const monthStartJst = (y: number, m: number) =>
    new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00+09:00`)
  const monthEndJst = (y: number, m: number) => {
    const s = monthStartJst(y, m)
    const e = new Date(s)
    e.setMonth(e.getMonth() + 1)
    return e
  }

  const assignMonthlyImpressions = (
    accum: Record<string, { sum: number; count: number } | null>,
    year: number,
    month: number,
    impressions: number | null,
  ) => {
    const ms = monthStartJst(year, month)
    const me = monthEndJst(year, month)

    const fullMonthPeriod = periods.find(p => p.start <= ms && p.end >= me)
    if (fullMonthPeriod) {
      addValue(accum, fullMonthPeriod.label, impressions)
      return
    }
    if (periods.length === 1) {
      const p = periods[0]!
      if (p.start < me && p.end > ms) addValue(accum, p.label, impressions)
    }
  }

  const { data: siteRow } = await supabase
    .from('gbp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .maybeSingle()

  const fillNull = (refKey: string) => {
    result[`gbp_search_keyword_monthly.${refKey}`] = Object.fromEntries(periods.map(p => [p.label, null]))
  }

  if (!siteRow) {
    for (const f of fields) fillNull(f)
    return result
  }

  const siteId = siteRow.id

  for (const rawField of fields) {
    const spec = parseSpec(rawField)
    const accum = emptyAccum(periods)
    if (!spec) {
      fillNull(rawField)
      continue
    }

    const { data: row } = await supabase
      .from('gbp_search_keyword_monthly')
      .select('impressions')
      .eq('gbp_site_id', siteId)
      .eq('year', spec.year)
      .eq('month', spec.month)
      .eq('search_keyword', spec.searchKeyword)
      .maybeSingle()

    const impressions = row?.impressions != null ? Number(row.impressions) : null
    assignMonthlyImpressions(accum, spec.year, spec.month, impressions)
    result[`gbp_search_keyword_monthly.${spec.refKey}`] = finalizeAccum(accum, 'sum')
  }

  return result
}

/** line_oam_friends_attr の field 指定: percentage@@gender=male@@age=20〜24歳 のようにスライス可 */
export function parseLineOamFriendsAttrField(rawField: string): {
  refKey: string
  column: 'percentage' | 'gender' | 'age'
  genderFilter: string | null
  ageFilter: string | null
} {
  const parts = rawField.split('@@').map((s) => s.trim()).filter(Boolean)
  let column: 'percentage' | 'gender' | 'age' = 'percentage'
  const kv: Record<string, string> = {}
  for (const p of parts) {
    if (!p.includes('=')) {
      if (p === 'percentage' || p === 'gender' || p === 'age') column = p
      continue
    }
    const idx = p.indexOf('=')
    const k = p.slice(0, idx).trim()
    const v = p.slice(idx + 1).trim()
    if (k) kv[k] = v
  }
  const genderFilter = kv.gender ?? kv.g ?? null
  const ageFilter = kv.age ?? kv.a ?? null
  return { refKey: rawField, column, genderFilter, ageFilter }
}

function rowMatchesAttrSlice(
  row: Record<string, unknown>,
  genderFilter: string | null,
  ageFilter: string | null,
): boolean {
  if (genderFilter != null && genderFilter !== '') {
    const g = row.gender != null ? String(row.gender).trim().toLowerCase() : ''
    if (g !== genderFilter.trim().toLowerCase()) return false
  }
  if (ageFilter != null && ageFilter !== '') {
    if (String(row.age ?? '').trim() !== ageFilter.trim()) return false
  }
  return true
}

/**
 * line_oam_friends_attr
 * date DATE, service_id FK
 * - 従来: gender / age は行カウント、percentage は期間内平均
 * - percentage@@gender=…@@age=… でスライス指定（該当行の percentage のみ集計）
 */
export async function fetchLineAttr(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd = periods[periods.length - 1].end.toISOString().slice(0, 10)

  const selectCols = ['date', 'gender', 'age', 'percentage'].join(',')

  const { data: rawRows } = await supabase
    .from('line_oam_friends_attr')
    .select(selectCols)
    .eq('service_id', serviceId)
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
  const rows = (rawRows ?? []) as unknown as Record<string, unknown>[]

  for (const field of fields) {
    const spec = parseLineOamFriendsAttrField(field)
    const accum = emptyAccum(periods)
    for (const row of rows) {
      if (!rowMatchesAttrSlice(row, spec.genderFilter, spec.ageFilter)) continue
      const label = bucketDate(new Date(row.date as string), periods)
      if (spec.column === 'percentage') {
        addValue(accum, label, row.percentage as number)
      } else if (spec.column === 'gender' || spec.column === 'age') {
        addValue(accum, label, row[spec.column] != null ? 1 : null)
      }
    }
    const mode = spec.column === 'percentage' ? 'avg' : 'sum'
    result[`line_oam_friends_attr.${spec.refKey}`] = finalizeAccum(accum, mode)
  }
  return result
}

export type LineOamFriendsAttrBreakdownSlice = { label: string; gender?: string | null; age?: string | null }

/**
 * サマリ内訳行用: 各期間ラベル × スライスの percentage（該当行が無いとき null）
 */
/**
 * 各期間ラベル × スライスの percentage（該当行が無いとき null）
 * 戻り値: periodLabel → スライス行
 */
export async function fetchLineOamFriendsAttrBreakdown(
  supabase: SupabaseServerClient,
  serviceId: string,
  slices: LineOamFriendsAttrBreakdownSlice[],
  periods: Period[],
): Promise<Record<string, Array<{ label: string; value: number | null }>>> {
  const out: Record<string, Array<{ label: string; value: number | null }>> = {}
  if (slices.length === 0) return out

  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd = periods[periods.length - 1].end.toISOString().slice(0, 10)

  const { data: rawRows } = await supabase
    .from('line_oam_friends_attr')
    .select('date,gender,age,percentage')
    .eq('service_id', serviceId)
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
  const rows = (rawRows ?? []) as unknown as Record<string, unknown>[]

  for (const period of periods) {
    const sliceVals: Array<{ label: string; value: number | null }> = []
    for (const sl of slices) {
      const matching = rows.filter((row) => {
        const d = new Date(row.date as string)
        if (d < period.start || d >= period.end) return false
        return rowMatchesAttrSlice(row, sl.gender ?? null, sl.age ?? null)
      })
      if (matching.length === 0) {
        sliceVals.push({ label: sl.label, value: null })
        continue
      }
      let sum = 0
      let n = 0
      for (const r of matching) {
        const p = r.percentage
        if (p != null && typeof p === 'number') {
          sum += p
          n++
        }
      }
      sliceVals.push({ label: sl.label, value: n > 0 ? Math.round((sum / n) * 100) / 100 : null })
    }
    out[period.label] = sliceVals
  }
  return out
}

/** テンプレの複数内訳行をまとめて取得（行 ID ごと） */
export async function fetchLineOamFriendsAttrBreakdownsByRow(
  supabase: SupabaseServerClient,
  serviceId: string,
  configs: { rowId: string; slices: LineOamFriendsAttrBreakdownSlice[] }[],
  periods: Period[],
): Promise<Record<string, Record<string, Array<{ label: string; value: number | null }>>>> {
  const merged: Record<string, Record<string, Array<{ label: string; value: number | null }>>> = {}
  await Promise.all(
    configs.map(async ({ rowId, slices }) => {
      merged[rowId] = await fetchLineOamFriendsAttrBreakdown(supabase, serviceId, slices, periods)
    }),
  )
  return merged
}

export type IgAccountInsightBreakdownSlice = {
  label: string
  dimension_code: string
  dimension_value: string
}

/**
 * Instagram アカウント lifetime インサイトの内訳（最新 value_date の値を各期間列に複製）
 */
export async function fetchIgAccountInsightBreakdown(
  supabase: SupabaseServerClient,
  serviceId: string,
  metricCode: string,
  slices: IgAccountInsightBreakdownSlice[],
  periods: Period[],
): Promise<Record<string, Array<{ label: string; value: number | null }>>> {
  const out: Record<string, Array<{ label: string; value: number | null }>> = {}
  if (slices.length === 0) return out

  const { data: igRow } = await supabase
    .from('ig_accounts')
    .select('id')
    .eq('service_id', serviceId)
    .maybeSingle()
  if (!igRow) {
    for (const p of periods) {
      out[p.label] = slices.map((s) => ({ label: s.label, value: null }))
    }
    return out
  }
  const accountId = igRow.id as string

  const sliceVals: Array<{ label: string; value: number | null }> = []
  for (const sl of slices) {
    const { data: row } = await supabase
      .from('ig_account_insight_fact')
      .select('value')
      .eq('account_id', accountId)
      .eq('metric_code', metricCode)
      .eq('period_code', 'lifetime')
      .eq('dimension_code', sl.dimension_code)
      .eq('dimension_value', sl.dimension_value)
      .order('value_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    const v = row?.value
    sliceVals.push({
      label: sl.label,
      value: v != null && typeof v === 'number' && Number.isFinite(v) ? v : null,
    })
  }

  for (const p of periods) {
    out[p.label] = sliceVals.map((s) => ({ ...s }))
  }
  return out
}

export async function fetchIgAccountInsightBreakdownsByRow(
  supabase: SupabaseServerClient,
  serviceId: string,
  configs: { rowId: string; metricCode: string; slices: IgAccountInsightBreakdownSlice[] }[],
  periods: Period[],
): Promise<Record<string, Record<string, Array<{ label: string; value: number | null }>>>> {
  const merged: Record<string, Record<string, Array<{ label: string; value: number | null }>>> = {}
  await Promise.all(
    configs.map(async ({ rowId, metricCode, slices }) => {
      merged[rowId] = await fetchIgAccountInsightBreakdown(supabase, serviceId, metricCode, slices, periods)
    }),
  )
  return merged
}

/**
 * line_oam_friends_daily
 * 直接カラム、date DATE, service_id FK
 */
export async function fetchLineFriendsDaily(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd   = periods[periods.length - 1].end.toISOString().slice(0, 10)
  const selectCols = ['date', ...fields].join(',')

  const { data: rawRows } = await supabase
    .from('line_oam_friends_daily')
    .select(selectCols)
    .eq('service_id', serviceId)
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
  const rows = (rawRows ?? []) as unknown as Record<string, unknown>[]

  for (const field of fields) {
    const accum = emptyAccum(periods)
    for (const row of rows) {
      const label = bucketDate(new Date(row.date as string), periods)
      addValue(accum, label, row[field] as number)
    }
    result[`line_oam_friends_daily.${field}`] = finalizeAccum(accum, 'sum')
  }
  return result
}

/**
 * line_oam_shopcard_status / line_oam_shopcard_point / line_oam_rewardcard_txns
 */
export async function fetchLineRewardcardTable(
  supabase: SupabaseServerClient,
  serviceId: string,
  tableName: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const { data: rcRows } = await supabase
    .from('line_oam_rewardcards')
    .select('id')
    .eq('service_id', serviceId)
  if (!rcRows || rcRows.length === 0) return result

  const rewardcardIds = rcRows.map(r => r.id)
  const rangeStart = periods[0].start.toISOString()
  const rangeEnd   = periods[periods.length - 1].end.toISOString()

  const dateCol = tableName === 'line_oam_rewardcard_txns' ? 'txn_datetime' : 'date'
  const selectCols = [dateCol, ...fields].join(',')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawRows } = await (supabase.from(tableName as any) as any)
    .select(selectCols)
    .in('line_rewardcard_id', rewardcardIds)
    .gte(dateCol, rangeStart)
    .lte(dateCol, rangeEnd)
  const rows = (rawRows ?? []) as Record<string, unknown>[]

  for (const field of fields) {
    const accum = emptyAccum(periods)
    for (const row of rows) {
      const rawDate = row[dateCol] as string
      const label = bucketDate(new Date(rawDate), periods)
      const rawVal = row[field]
      // テキスト型フィールド（customer_id, point_type 等）は non-null カウント
      // 数値型フィールドはそのまま加算
      const numVal: number | null | undefined =
        typeof rawVal === 'string'
          ? 1          // テキスト値は「存在する = 1」としてカウント
          : (rawVal as number | null | undefined)
      addValue(accum, label, numVal)
    }
    result[`${tableName}.${field}`] = finalizeAccum(accum, AVG_FIELDS.has(field) ? 'avg' : 'sum')
  }
  return result
}

/**
 * metric_summaries (LP KPI)
 * pivot: metric_name = field, summary_date DATE, service_id FK
 */
export async function fetchMetricSummaries(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd   = periods[periods.length - 1].end.toISOString().slice(0, 10)

  for (const field of fields) {
    const accum = emptyAccum(periods)
    const { data: rows } = await supabase
      .from('metric_summaries')
      .select('summary_date, metric_value_numeric')
      .eq('service_id', serviceId)
      .eq('metric_name', field)
      .eq('range_type', 'today')
      .gte('summary_date', rangeStart)
      .lte('summary_date', rangeEnd)

    for (const row of rows ?? []) {
      const label = bucketDate(new Date(row.summary_date), periods)
      addValue(accum, label, row.metric_value_numeric)
    }
    result[`metric_summaries.${field}`] = finalizeAccum(
      accum,
      field === 'avg_stay_seconds' ? 'avg' : 'sum',
    )
  }
  return result
}

/**
 * LP ローテーブル (lp_sessions / lp_page_views / lp_event_logs / lp_users)
 */
export async function fetchLpTable(
  supabase: SupabaseServerClient,
  serviceId: string,
  tableName: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const { data: siteRow } = await supabase
    .from('lp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()
  if (!siteRow) return result

  const siteId = siteRow.id
  const rangeStart = periods[0].start.toISOString()
  const rangeEnd   = periods[periods.length - 1].end.toISOString()

  const DATE_COL: Record<string, string> = {
    lp_sessions:   'started_at',
    lp_page_views: 'occurred_at',
    lp_event_logs: 'occurred_at',
    lp_users:      'first_visited_at',
  }
  const dateCol = DATE_COL[tableName] ?? 'created_at'

  const colMap: Record<string, string> = {
    'lp_event_logs.intent_score': 'intent_score_snapshot',
  }
  const dbFields = fields.map(f => colMap[`${tableName}.${f}`] ?? f)
  const selectCols = [dateCol, ...new Set(dbFields)].join(',')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawRows } = await (supabase.from(tableName as any) as any)
    .select(selectCols)
    .eq('lp_site_id', siteId)
    .gte(dateCol, rangeStart)
    .lte(dateCol, rangeEnd)
  const rows = (rawRows ?? []) as Record<string, unknown>[]

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    const dbCol = dbFields[i]
    const accum = emptyAccum(periods)
    for (const row of rows) {
      const rawDate = row[dateCol] as string
      const label = bucketDate(new Date(rawDate), periods)
      addValue(accum, label, row[dbCol] as number)
    }
    result[`${tableName}.${field}`] = finalizeAccum(accum, AVG_FIELDS.has(field) ? 'avg' : 'sum')
  }
  return result
}

/**
 * 売上分析サービス（sales_days + sales_hourly_slots + orders を日付バケットに集約）
 * metric_ref は仮想テーブル sales_rollup.*（project_metrics_daily / 統合サマリー用）
 */
export async function fetchSalesRollup(
  supabase: SupabaseServerClient,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd = periods[periods.length - 1].end.toISOString().slice(0, 10)

  const { data: dayRows, error: dayErr } = await supabase
    .from('sales_days')
    .select('id, sales_date')
    .eq('service_id', serviceId)
    .gte('sales_date', rangeStart)
    .lte('sales_date', rangeEnd)

  if (dayErr) {
    console.error('[fetchSalesRollup] sales_days error:', dayErr)
    for (const field of fields) {
      result[`sales_rollup.${field}`] = Object.fromEntries(periods.map(p => [p.label, null]))
    }
    return result
  }

  const days = dayRows ?? []
  const dayIdToDate = new Map<string, string>(
    days.map(d => [d.id as string, String(d.sales_date).slice(0, 10)]),
  )

  if (days.length === 0) {
    for (const field of fields) {
      result[`sales_rollup.${field}`] = Object.fromEntries(periods.map(p => [p.label, null]))
    }
    return result
  }

  const dayIds = days.map(d => d.id as string)
  const { data: slotRows, error: slotErr } = await supabase
    .from('sales_hourly_slots')
    .select('id, sales_day_id, slot_label, total_amount_with_tax, total_amount_without_tax, is_rest_break')
    .in('sales_day_id', dayIds)

  if (slotErr) {
    console.error('[fetchSalesRollup] sales_hourly_slots error:', slotErr)
    for (const field of fields) {
      result[`sales_rollup.${field}`] = Object.fromEntries(periods.map(p => [p.label, null]))
    }
    return result
  }

  const allSlots = slotRows ?? []
  const slotsForRevenue = salesHourlySlotsForRevenueSumByDay(allSlots)
  const slotIdToDate = new Map<string, string>()
  for (const s of allSlots) {
    const sid = s.sales_day_id as string
    const d = dayIdToDate.get(sid)
    if (d) slotIdToDate.set(s.id as string, d)
  }

  const orderCountsByDate = new Map<string, number>()
  if (allSlots.length > 0) {
    const slotIds = allSlots.map(s => s.id as string)
    const { data: orderRows, error: ordErr } = await supabase
      .from('orders')
      .select('id, sales_hourly_slot_id')
      .in('sales_hourly_slot_id', slotIds)

    if (ordErr) {
      console.error('[fetchSalesRollup] orders error:', ordErr)
    } else {
      for (const o of orderRows ?? []) {
        const slotId = o.sales_hourly_slot_id as string
        const dateStr = slotIdToDate.get(slotId)
        if (!dateStr) continue
        orderCountsByDate.set(dateStr, (orderCountsByDate.get(dateStr) ?? 0) + 1)
      }
    }
  }

  const accWithTax = emptyAccum(periods)
  const accWithoutTax = emptyAccum(periods)
  const accSlots = emptyAccum(periods)
  const accRest = emptyAccum(periods)
  const accOrders = emptyAccum(periods)

  for (const s of slotsForRevenue) {
    const dateStr = dayIdToDate.get(s.sales_day_id as string)
    if (!dateStr) continue
    const label = bucketDate(new Date(`${dateStr}T12:00:00+09:00`), periods)
    if (!label) continue

    const wt = s.total_amount_with_tax as number | null
    const wtx = s.total_amount_without_tax as number | null
    if (wt != null) addValue(accWithTax, label, wt)
    if (wtx != null) addValue(accWithoutTax, label, wtx)
    addValue(accSlots, label, 1)
    if (s.is_rest_break === true) addValue(accRest, label, 1)
  }

  for (const [dateStr, cnt] of orderCountsByDate) {
    const label = bucketDate(new Date(`${dateStr}T12:00:00+09:00`), periods)
    if (!label) continue
    addValue(accOrders, label, cnt)
  }

  const finalize = (accum: Record<string, { sum: number; count: number } | null>) =>
    finalizeAccum(accum, 'sum')

  for (const field of fields) {
    const ref = `sales_rollup.${field}`
    switch (field) {
      case 'total_amount_with_tax':
        result[ref] = finalize(accWithTax)
        break
      case 'total_amount_without_tax':
        result[ref] = finalize(accWithoutTax)
        break
      case 'slot_count':
        result[ref] = finalize(accSlots)
        break
      case 'rest_break_slot_count':
        result[ref] = finalize(accRest)
        break
      case 'order_count':
        result[ref] = finalize(accOrders)
        break
      default:
        result[ref] = Object.fromEntries(periods.map(p => [p.label, null]))
    }
  }

  return result
}

// ── 統合ディスパッチャ ──────────────────────────────────────────────────────

/**
 * fieldRefs（"table.field" 形式のリスト）を受け取り、
 * テーブルごとに並列クエリして結果をマージする。
 * unified-summary と summary/data の両方から使用できる。
 */
export async function fetchMetricsByRefs(
  supabase: SupabaseServerClient,
  serviceId: string,
  fieldRefs: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  // "table.field" のリストをテーブル別にグループ化
  const byTable: Record<string, string[]> = {}
  for (const ref of fieldRefs) {
    const dot = ref.indexOf('.')
    if (dot < 0) continue
    const table = ref.slice(0, dot)
    const field = ref.slice(dot + 1)
    ;(byTable[table] ??= []).push(field)
  }

  const queries: Promise<Record<string, Record<string, number | null>>>[] = []

  const googleAdsTables: GoogleAdsDailyTable[] = [
    'google_ads_campaign_daily',
    'google_ads_adgroup_daily',
    'google_ads_keyword_daily',
  ]
  const googleAdsEntries = googleAdsTables.flatMap((logicalTable) =>
    (byTable[logicalTable] ?? []).map((field) => ({ logicalTable, field })),
  )
  if (googleAdsEntries.length > 0) {
    queries.push(fetchGoogleAdsDailyAggregate(supabase, serviceId, googleAdsEntries, periods))
  }

  for (const [table, fields] of Object.entries(byTable)) {
    switch (table) {
      case 'google_ads_campaign_daily':
      case 'google_ads_adgroup_daily':
      case 'google_ads_keyword_daily':
        break
      case 'ig_account_insight_fact':
        queries.push(fetchIgAccountInsight(supabase, serviceId, fields, periods))
        break
      case 'gbp_performance_daily':
        queries.push(fetchGbpPerformance(supabase, serviceId, fields, periods))
        break
      case 'gbp_reviews':
        queries.push(fetchGbpReviews(supabase, serviceId, fields, periods))
        break
      case 'gbp_review_star_counts_daily':
        queries.push(fetchGbpReviewStarCountsDaily(supabase, serviceId, fields, periods))
        break
      case 'gbp_search_keyword_monthly':
        queries.push(fetchGbpSearchKeywordMonthly(supabase, serviceId, fields, periods))
        break
      case 'line_oam_friends_daily':
        queries.push(fetchLineFriendsDaily(supabase, serviceId, fields, periods))
        break
      case 'line_oam_friends_attr':
        queries.push(fetchLineAttr(supabase, serviceId, fields, periods))
        break
      case 'line_oam_shopcard_status':
      case 'line_oam_shopcard_point':
      case 'line_oam_rewardcard_txns':
        queries.push(fetchLineRewardcardTable(supabase, serviceId, table, fields, periods))
        break
      case 'metric_summaries':
        queries.push(fetchMetricSummaries(supabase, serviceId, fields, periods))
        break
      case 'lp_sessions':
      case 'lp_page_views':
      case 'lp_event_logs':
      case 'lp_users':
        queries.push(fetchLpTable(supabase, serviceId, table, fields, periods))
        break
      case 'ig_media_insight_feed':
        queries.push(fetchIgMediaInsightByProduct(supabase, serviceId, 'ig_media_insight_feed', fields, periods))
        break
      case 'ig_media_insight_reels':
        queries.push(fetchIgMediaInsightByProduct(supabase, serviceId, 'ig_media_insight_reels', fields, periods))
        break
      case 'ig_media_insight_story':
        queries.push(fetchIgMediaInsightByProduct(supabase, serviceId, 'ig_media_insight_story', fields, periods))
        break
      case 'sales_rollup':
        queries.push(fetchSalesRollup(supabase, serviceId, fields, periods))
        break
      default:
        break
    }
  }

  // allSettled で実行: 1テーブルが失敗しても他テーブルの結果は反映する
  const settled = await Promise.allSettled(queries)
  const merged: Record<string, Record<string, number | null>> = {}
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      Object.assign(merged, result.value)
    } else {
      console.error('[fetchMetricsByRefs] handler error:', result.reason)
    }
  }

  // 未実装テーブルのフィールドは null で埋める
  for (const ref of fieldRefs) {
    if (!(ref in merged)) {
      merged[ref] = Object.fromEntries(periods.map(p => [p.label, null]))
    }
  }

  await applyIgAccountFormulaKpis(supabase, serviceId, fieldRefs, periods, merged)

  return merged
}

const IG_FORMULA_KPI_PREFIX = 'ig_account_insight_fact@formula:'

/** KPI設定用: アカウント日次から算出する派生指標（カタログの仮想 id と対応） */
async function applyIgAccountFormulaKpis(
  supabase: SupabaseServerClient,
  serviceId: string,
  fieldRefs: string[],
  periods: Period[],
  merged: Record<string, Record<string, number | null>>,
) {
  const wanted = fieldRefs.filter((r) => r.startsWith(IG_FORMULA_KPI_PREFIX))
  if (wanted.length === 0) return

  const g = (suffix: string): Record<string, number | null> =>
    merged[`ig_account_insight_fact.${suffix}`] ??
    Object.fromEntries(periods.map((p) => [p.label, null]))

  const divPct = (num: number | null, den: number | null): number | null => {
    if (num == null || den == null || den === 0) return null
    return Math.round((num / den) * 10_000) / 100
  }

  const rangeStart =
    periods.length === 1 && periods[0].rangeStart
      ? periods[0].rangeStart
      : periods[0].start.toISOString().slice(0, 10)
  const rangeEnd =
    periods.length === 1 && periods[0].rangeEnd
      ? periods[0].rangeEnd
      : periods[periods.length - 1].end.toISOString().slice(0, 10)

  let followerDelta: number | null = null
  if (
    wanted.some(
      (w) =>
        w === `${IG_FORMULA_KPI_PREFIX}kpi_follow_rate_30d` ||
        w === `${IG_FORMULA_KPI_PREFIX}kpi_link_click_rate_30d`,
    )
  ) {
    followerDelta = await fetchFollowerCountDeltaInRange(supabase, serviceId, rangeStart, rangeEnd)
  }

  const savesByLabel = g('saves')
  const reachByLabel = g('reach')
  const profileViewsByLabel = g('profile_views')
  const linkTapsByLabel = g('profile_links_taps')
  const followerViewsByLabel = g('views@@follower_type=FOLLOWER')

  const singleBucket = periods.length === 1

  for (const ref of wanted) {
    const id = ref.slice(IG_FORMULA_KPI_PREFIX.length)
    const out: Record<string, number | null> = Object.fromEntries(periods.map((p) => [p.label, null]))

    for (const p of periods) {
      const lab = p.label
      if (id === 'kpi_home_rate_proxy') {
        // 投稿別ホーム÷フォロワービューは DB に無いため、日次の「プロフィール閲覧 ÷ 閲覧（フォロワー内訳）」を目安%として返す
        out[lab] = divPct(profileViewsByLabel[lab] ?? null, followerViewsByLabel[lab] ?? null)
      } else if (id === 'kpi_save_rate') {
        out[lab] = divPct(savesByLabel[lab] ?? null, reachByLabel[lab] ?? null)
      } else if (id === 'kpi_profile_access_rate') {
        out[lab] = divPct(profileViewsByLabel[lab] ?? null, reachByLabel[lab] ?? null)
      } else if (id === 'kpi_follow_rate_30d') {
        if (singleBucket) {
          const pv = profileViewsByLabel[lab] ?? null
          out[lab] = divPct(followerDelta, pv)
        }
      } else if (id === 'kpi_link_click_rate_30d') {
        if (singleBucket) {
          const taps = linkTapsByLabel[lab] ?? null
          const pv = profileViewsByLabel[lab] ?? null
          out[lab] = divPct(taps, pv)
        }
      }
    }
    merged[ref] = out
  }
}

/** 期間内のフォロワー数（日次スナップ）の増減: 期末近傍 − 期首 */
async function fetchFollowerCountDeltaInRange(
  supabase: SupabaseServerClient,
  serviceId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<number | null> {
  const { data: igRow } = await supabase.from('ig_accounts').select('id').eq('service_id', serviceId).maybeSingle()
  if (!igRow) return null

  const { data: minRow } = await supabase
    .from('ig_account_insight_fact')
    .select('value')
    .eq('account_id', igRow.id)
    .eq('metric_code', 'follower_count')
    .eq('period_code', 'day')
    .eq('dimension_code', '')
    .eq('dimension_value', '')
    .gte('value_date', rangeStart)
    .lte('value_date', rangeEnd)
    .order('value_date', { ascending: true })
    .limit(1)
    .maybeSingle()

  const { data: maxRow } = await supabase
    .from('ig_account_insight_fact')
    .select('value')
    .eq('account_id', igRow.id)
    .eq('metric_code', 'follower_count')
    .eq('period_code', 'day')
    .eq('dimension_code', '')
    .eq('dimension_value', '')
    .gte('value_date', rangeStart)
    .lte('value_date', rangeEnd)
    .order('value_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const a = typeof minRow?.value === 'number' ? minRow.value : null
  const b = typeof maxRow?.value === 'number' ? maxRow.value : null
  if (a == null || b == null) return null
  const d = b - a
  return d > 0 ? d : 0
}
