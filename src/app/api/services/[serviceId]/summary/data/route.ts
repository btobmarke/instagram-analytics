/**
 * GET /api/services/[serviceId]/summary/data
 *
 * サマリービュー用 集計データ取得エンドポイント
 *
 * Query params:
 *   fields    カンマ区切り "table.field" リスト (例: ig_account_insight_fact.reach,gbp_performance_daily.call_clicks)
 *   timeUnit  day | week | month | hour (default: day)
 *   count     期間数 (default: 8)
 *
 * Response:
 *   { success: true, data: { [fieldRef]: { [timeLabel]: number | null } } }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type TimeUnit = 'hour' | 'day' | 'week' | 'month'

interface Period {
  label: string
  start: Date
  end: Date
}

// ── 期間生成（フロントエンドと同じラベルフォーマット） ──────────
function generatePeriods(unit: TimeUnit, count: number): Period[] {
  const periods: Period[] = []
  const now = new Date()

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
      case 'day': {
        d.setDate(d.getDate() - i)
        d.setHours(0, 0, 0, 0)
        start = new Date(d)
        end = new Date(d); end.setDate(end.getDate() + 1)
        label = `${d.getMonth() + 1}/${d.getDate()}`
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
    }
    periods.push({ label, start: start!, end: end! })
  }
  return periods
}

/** 日付を対応する期間ラベルに変換 */
function bucketDate(d: Date, periods: Period[]): string | null {
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

/** accumに値を加算 */
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
const AVG_FIELDS = new Set([
  'avg_stay_seconds', 'session_intent_score', 'duration_seconds',
  'interaction_count', 'scroll_percent_max', 'stay_seconds',
  'percentage', 'intent_score',
])

// ── テーブルごとのクエリハンドラ ────────────────────────────────

/**
 * ig_account_insight_fact
 * pivot: metric_code = field, value_date DATE
 * FK: account_id → ig_accounts.id ← instagram_accounts.ig_account_ref_id ← service_id
 */
async function fetchIgAccountInsight(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  // service_id → ig_account_id
  const { data: iaRow } = await supabase
    .from('instagram_accounts')
    .select('ig_account_ref_id')
    .eq('service_id', serviceId)
    .single()
  if (!iaRow) return result

  const accountId = iaRow.ig_account_ref_id
  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd   = periods[periods.length - 1].end.toISOString().slice(0, 10)

  for (const field of fields) {
    const accum = emptyAccum(periods)
    const { data: rows } = await supabase
      .from('ig_account_insight_fact')
      .select('value_date, value')
      .eq('account_id', accountId)
      .eq('metric_code', field)
      .eq('period_code', 'DAY')
      .gte('value_date', rangeStart)
      .lte('value_date', rangeEnd)

    for (const row of rows ?? []) {
      const label = bucketDate(new Date(row.value_date), periods)
      addValue(accum, label, row.value)
    }
    result[`ig_account_insight_fact.${field}`] = finalizeAccum(accum, 'sum')
  }
  return result
}

/**
 * gbp_performance_daily
 * 直接カラム、date DATE
 * FK: gbp_site_id → gbp_sites.service_id
 */
async function fetchGbpPerformance(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
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

  const { data: rawRows1 } = await supabase
    .from('gbp_performance_daily')
    .select(selectCols)
    .eq('gbp_site_id', siteId)
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
  const rows = (rawRows1 ?? []) as unknown as Record<string, unknown>[]

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
async function fetchLineFriendsDaily(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  const rangeStart = periods[0].start.toISOString().slice(0, 10)
  const rangeEnd   = periods[periods.length - 1].end.toISOString().slice(0, 10)
  const selectCols = ['date', ...fields].join(',')

  const { data: rawRows2 } = await supabase
    .from('line_oam_friends_daily')
    .select(selectCols)
    .eq('service_id', serviceId)
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
  const rows = (rawRows2 ?? []) as unknown as Record<string, unknown>[]

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
 * FK: line_rewardcard_id → line_oam_rewardcards.id → service_id
 */
async function fetchLineRewardcardTable(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string,
  tableName: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  // service_id → rewardcard ids
  const { data: rcRows } = await supabase
    .from('line_oam_rewardcards')
    .select('id')
    .eq('service_id', serviceId)
  if (!rcRows || rcRows.length === 0) return result

  const rewardcardIds = rcRows.map(r => r.id)
  const rangeStart = periods[0].start.toISOString()
  const rangeEnd   = periods[periods.length - 1].end.toISOString()

  // txns は txn_datetime, それ以外は date
  const dateCol = tableName === 'line_oam_rewardcard_txns' ? 'txn_datetime' : 'date'
  const selectCols = [dateCol, ...fields].join(',')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawRows3 } = await (supabase.from(tableName as any) as any)
    .select(selectCols)
    .in('line_rewardcard_id', rewardcardIds)
    .gte(dateCol, rangeStart)
    .lte(dateCol, rangeEnd)
  const rows = (rawRows3 ?? []) as Record<string, unknown>[]

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
async function fetchMetricSummaries(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
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
 * FK: lp_site_id → lp_sites.service_id
 */
async function fetchLpTable(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string,
  tableName: string,
  fields: string[],
  periods: Period[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}

  // service_id → lp_site_id
  const { data: siteRow } = await supabase
    .from('lp_sites')
    .select('id')
    .eq('service_id', serviceId)
    .single()
  if (!siteRow) return result

  const siteId = siteRow.id
  const rangeStart = periods[0].start.toISOString()
  const rangeEnd   = periods[periods.length - 1].end.toISOString()

  // date column per table
  const DATE_COL: Record<string, string> = {
    lp_sessions:   'started_at',
    lp_page_views: 'occurred_at',
    lp_event_logs: 'occurred_at',
    lp_users:      'first_visited_at',
  }
  const dateCol = DATE_COL[tableName] ?? 'created_at'

  // lp_event_logs の intent_score は DB カラム名が intent_score_snapshot
  const colMap: Record<string, string> = {
    'lp_event_logs.intent_score': 'intent_score_snapshot',
  }

  // カタログのフィールド名 → 実際のDBカラム名
  const dbFields = fields.map(f => colMap[`${tableName}.${f}`] ?? f)
  const selectCols = [dateCol, ...new Set(dbFields)].join(',')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawRows4 } = await (supabase.from(tableName as any) as any)
    .select(selectCols)
    .eq('lp_site_id', siteId)
    .gte(dateCol, rangeStart)
    .lte(dateCol, rangeEnd)
  const rows = (rawRows4 ?? []) as Record<string, unknown>[]

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

// ── メインハンドラ ─────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    )
  }

  // クエリパラメータ解析
  const url = new URL(req.url)
  const rawFields = url.searchParams.get('fields') ?? ''
  const timeUnit  = (url.searchParams.get('timeUnit') ?? 'day') as TimeUnit
  const count     = Math.min(parseInt(url.searchParams.get('count') ?? '8', 10), 24)

  if (!rawFields) {
    return NextResponse.json({ success: true, data: {} })
  }

  // "table.field" のリストをテーブル別にグループ化
  const fieldRefs = rawFields.split(',').map(s => s.trim()).filter(Boolean)
  const byTable: Record<string, string[]> = {}
  for (const ref of fieldRefs) {
    const dot = ref.indexOf('.')
    if (dot < 0) continue
    const table = ref.slice(0, dot)
    const field = ref.slice(dot + 1)
    ;(byTable[table] ??= []).push(field)
  }

  const periods = generatePeriods(timeUnit, count)
  const merged: Record<string, Record<string, number | null>> = {}

  // テーブルごとにクエリを実行
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
      // ig_media_insight_feed/reels/story など未実装テーブル → null のまま
      default:
        break
    }
  }

  // 並列実行してマージ
  const results = await Promise.all(queries)
  for (const r of results) {
    Object.assign(merged, r)
  }

  // 未実装テーブルのフィールドは null で埋めておく
  for (const ref of fieldRefs) {
    if (!(ref in merged)) {
      merged[ref] = Object.fromEntries(periods.map(p => [p.label, null]))
    }
  }

  return NextResponse.json({ success: true, data: merged })
}
