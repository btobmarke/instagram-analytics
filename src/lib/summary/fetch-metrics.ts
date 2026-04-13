/**
 * サービス別指標取得関数（共有ライブラリ）
 *
 * このファイルの関数は以下から利用される:
 *   - /api/services/[serviceId]/summary/data (サービス単体サマリー)
 *   - /api/projects/[projectId]/unified-summary (プロジェクト横断サマリー)
 */

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { generateCustomRangePeriod, generateJstDayPeriods } from '@/lib/summary/jst-periods'

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
    const accum = emptyAccum(periods)
    const { data: rows } = await supabase
      .from('ig_account_insight_fact')
      .select('value_date, value')
      .eq('account_id', accountId)
      .eq('metric_code', field)
      .eq('period_code', 'day')
      .gte('value_date', rangeStart)
      .lte('value_date', rangeEnd)

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
    result[`ig_account_insight_fact.${field}`] = finalizeAccum(accum, 'sum')
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
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from('ig_media_insight_fact')
      .select('media_id, metric_code, value, snapshot_at')
      .in('media_id', mediaIds)
      .in('metric_code', fieldUniq)
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
    const k = `${row.media_id}\0${row.metric_code}`
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
      addValue(accum, label, row[field] as number)
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

  for (const [table, fields] of Object.entries(byTable)) {
    switch (table) {
      case 'ig_account_insight_fact':
        queries.push(fetchIgAccountInsight(supabase, serviceId, fields, periods))
        break
      case 'gbp_performance_daily':
        queries.push(fetchGbpPerformance(supabase, serviceId, fields, periods))
        break
      case 'line_oam_friends_daily':
        queries.push(fetchLineFriendsDaily(supabase, serviceId, fields, periods))
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
      default:
        break
    }
  }

  const results = await Promise.all(queries)
  const merged: Record<string, Record<string, number | null>> = {}
  for (const r of results) {
    Object.assign(merged, r)
  }

  // 未実装テーブルのフィールドは null で埋める
  for (const ref of fieldRefs) {
    if (!(ref in merged)) {
      merged[ref] = Object.fromEntries(periods.map(p => [p.label, null]))
    }
  }

  return merged
}
