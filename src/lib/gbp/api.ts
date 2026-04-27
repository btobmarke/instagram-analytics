// ============================================================
// GBP API クライアント
// Business Profile Performance API / Account Management API
// ============================================================

import {
  GBP_API_BASE,
  GBP_ACCOUNT_API_BASE,
  GBP_INFO_API_BASE,
  ALL_DAILY_METRICS,
  METRIC_TO_COLUMN,
  type DailyMetric,
} from './constants'

// ------------------------------------------------
// 型定義
// ------------------------------------------------

export interface GbpLocation {
  name:        string   // "locations/123456789"
  accountName: string   // "accounts/123456789"
  title:       string   // 店舗名
  storefrontAddress?: { locality?: string; administrativeArea?: string }
}

export interface GbpDailyRow {
  date:    string  // "YYYY-MM-DD"
  metrics: Record<string, number | null>
  rawPayload?: unknown
}

export interface GbpReview {
  reviewId:        string
  starRating:      string  // ONE/TWO/THREE/FOUR/FIVE
  comment?:        string
  createTime:      string
  updateTime?:     string
  reviewer?: {
    displayName?: string
    profilePhotoUrl?: string
  }
  reviewReply?: {
    comment:     string
    updateTime:  string
  }
}

/** Performance API: locations.searchkeywords.impressions.monthly（1カ月分） */
export interface GbpSearchKeywordMonthlyItem {
  searchKeyword: string
  impressions:  number | null
  threshold:    string | null
}

/**
 * UNIQUE(gbp_site_id, year, month, search_keyword) と同一視するキーワード表現。
 * API が同一キーワードを表記ゆれ・互換文字列で複数行返すと、1 文の upsert で Postgres が
 * 「ON CONFLICT DO UPDATE command cannot affect row a second time」を返す。
 */
export function gbpSearchKeywordMonthlyCanonical(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  try {
    return t.normalize('NFKC')
  } catch {
    return t
  }
}

/**
 * GBP API が同一月・同一キーワードを複数行返すことがある。
 * 1 文の upsert で ON CONFLICT ... が同じ行に 2 回当たると Postgres が 21000 を返すためマージする。
 */
function mergeSearchKeywordMonthly(
  a: GbpSearchKeywordMonthlyItem,
  b: GbpSearchKeywordMonthlyItem
): GbpSearchKeywordMonthlyItem {
  const kw = gbpSearchKeywordMonthlyCanonical(a.searchKeyword)
  const ai = a.impressions
  const bi = b.impressions
  if (ai != null && bi != null) {
    return { searchKeyword: kw, impressions: Math.max(ai, bi), threshold: a.threshold ?? b.threshold }
  }
  if (ai != null) return { searchKeyword: kw, impressions: ai, threshold: a.threshold ?? b.threshold }
  if (bi != null) return { searchKeyword: kw, impressions: bi, threshold: b.threshold ?? a.threshold }
  return { searchKeyword: kw, impressions: null, threshold: a.threshold ?? b.threshold }
}

function dedupeSearchKeywordMonthlyItems(items: GbpSearchKeywordMonthlyItem[]): GbpSearchKeywordMonthlyItem[] {
  const map = new Map<string, GbpSearchKeywordMonthlyItem>()
  for (const it of items) {
    const key = gbpSearchKeywordMonthlyCanonical(it.searchKeyword)
    if (!key) continue
    const canonical: GbpSearchKeywordMonthlyItem = { ...it, searchKeyword: key }
    const prev = map.get(key)
    map.set(key, prev ? mergeSearchKeywordMonthly(prev, canonical) : canonical)
  }
  return [...map.values()]
}

/** gbp_search_keyword_monthly へ渡す直前の最終重複除去（防御的） */
export function dedupeGbpSearchKeywordMonthlyUpsertRows<
  T extends {
    search_keyword: string
    impressions: number | null
    threshold: string | null
  },
>(rows: T[]): T[] {
  const map = new Map<string, T>()
  for (const r of rows) {
    const key = gbpSearchKeywordMonthlyCanonical(r.search_keyword)
    if (!key) continue
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { ...r, search_keyword: key } as T)
      continue
    }
    const ai = prev.impressions
    const bi = r.impressions
    let impressions: number | null
    if (ai != null && bi != null) impressions = Math.max(ai, bi)
    else if (ai != null) impressions = ai
    else if (bi != null) impressions = bi
    else impressions = null
    const threshold = prev.threshold ?? r.threshold
    map.set(key, { ...prev, search_keyword: key, impressions, threshold } as T)
  }
  return [...map.values()]
}

// ------------------------------------------------
// 共通フェッチ（429/503 はリトライ）
// ------------------------------------------------

const GBP_FETCH_MAX_ATTEMPTS = Math.min(
  8,
  Math.max(1, parseInt(process.env.GBP_API_MAX_RETRIES ?? '5', 10) || 5)
)

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function gbpFetch(url: string, accessToken: string, options?: RequestInit): Promise<unknown> {
  let lastBody = ''
  let lastStatus = 0

  for (let attempt = 1; attempt <= GBP_FETCH_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    })

    lastStatus = res.status
    lastBody = await res.text()

    if (res.ok) {
      const t = lastBody.trim()
      return (t ? (JSON.parse(t) as unknown) : ({} as unknown))
    }

    // 認証エラーはリトライしない（バッチ側で auth_status=error に）
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`GBP API auth error: ${res.status} ${lastBody}`)
      ;(err as Error & { isAuthError: boolean }).isAuthError = true
      throw err
    }

    const retryable = res.status === 429 || res.status === 503
    if (retryable && attempt < GBP_FETCH_MAX_ATTEMPTS) {
      const retryAfter = res.headers.get('Retry-After')
      let delayMs = Math.min(60_000, 1000 * 2 ** (attempt - 1))
      if (retryAfter) {
        const sec = parseInt(retryAfter, 10)
        if (!Number.isNaN(sec)) delayMs = Math.min(120_000, sec * 1000)
      }
      console.warn(
        `[gbpFetch] ${res.status} retry ${attempt}/${GBP_FETCH_MAX_ATTEMPTS} in ${delayMs}ms`,
        url.slice(0, 120)
      )
      await sleep(delayMs)
      continue
    }

    throw new Error(`GBP API error: ${res.status} ${lastBody}`)
  }

  throw new Error(`GBP API error: ${lastStatus} ${lastBody}`)
}

// ------------------------------------------------
// アカウント配下のロケーション一覧を取得
// ------------------------------------------------
export async function listLocations(accessToken: string): Promise<GbpLocation[]> {
  // まずアカウント一覧を取得
  const accountsData = await gbpFetch(
    `${GBP_ACCOUNT_API_BASE}/accounts`,
    accessToken
  ) as { accounts?: Array<{ name: string }> }

  const accounts = accountsData.accounts ?? []
  const allLocations: GbpLocation[] = []

  for (const account of accounts) {
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({ pageSize: '100' })
      if (pageToken) params.set('pageToken', pageToken)

      const locData = await gbpFetch(
        `${GBP_INFO_API_BASE}/${account.name}/locations?${params}&readMask=name,title,storefrontAddress`,
        accessToken
      ) as { locations?: Omit<GbpLocation, 'accountName'>[]; nextPageToken?: string }

      if (locData.locations) {
        // accountName をセット（レビューAPI用に必要）
        allLocations.push(...locData.locations.map(loc => ({
          ...loc,
          accountName: account.name,
        })))
      }
      pageToken = locData.nextPageToken
    } while (pageToken)
  }

  return allLocations
}

// ------------------------------------------------
// ロケーション情報を取得（title同期用）
// ------------------------------------------------
export async function getLocation(accessToken: string, locationName: string): Promise<GbpLocation | null> {
  try {
    const data = await gbpFetch(
      `${GBP_INFO_API_BASE}/${locationName}?readMask=name,title`,
      accessToken
    ) as GbpLocation
    return data
  } catch {
    return null
  }
}

// ------------------------------------------------
// Performance 指標を取得（fetchMultiDailyMetricsTimeSeries相当）
// DATA_LAYOUT.md の11指標を全て取得
// ------------------------------------------------
export async function fetchPerformance(params: {
  accessToken:  string
  locationName: string  // "locations/123456789"
  startDate:    Date
  endDate:      Date
}): Promise<GbpDailyRow[]> {
  // GET + クエリパラメータ形式（POSTではない）
  const query = new URLSearchParams()

  // 各メトリクスを個別に追加
  for (const metric of ALL_DAILY_METRICS) {
    query.append('dailyMetrics', metric)
  }

  // カレンダー日は UTC 成分で送る（呼び出し側は UTC 午前0時の Date を渡すこと）
  query.set('dailyRange.startDate.year',  String(params.startDate.getUTCFullYear()))
  query.set('dailyRange.startDate.month', String(params.startDate.getUTCMonth() + 1))
  query.set('dailyRange.startDate.day',   String(params.startDate.getUTCDate()))

  query.set('dailyRange.endDate.year',  String(params.endDate.getUTCFullYear()))
  query.set('dailyRange.endDate.month', String(params.endDate.getUTCMonth() + 1))
  query.set('dailyRange.endDate.day',   String(params.endDate.getUTCDate()))

  const url = `${GBP_API_BASE}/v1/${params.locationName}:fetchMultiDailyMetricsTimeSeries?${query}`
  console.log('[fetchPerformance] URL:', url)

  interface DatedValue {
    date: { year: number; month: number; day: number }
    value?: string
  }
  interface DailyMetricSeries {
    dailyMetric: string
    dailySubEntityType?: string
    timeSeries: { datedValues: DatedValue[] }
  }
  const data = await gbpFetch(url, params.accessToken) as {
    multiDailyMetricTimeSeries?: Array<{
      // 実際のレスポンスは dailyMetricTimeSeries にネストされている
      dailyMetricTimeSeries?: DailyMetricSeries[]
      // 直下に来るパターン（フォールバック）
      dailyMetric?: string
      timeSeries?: { datedValues: DatedValue[] }
    }>
  }

  // 実際のシリーズ配列を取り出す（ネスト構造に対応）
  const allSeries: DailyMetricSeries[] = []
  for (const outer of data.multiDailyMetricTimeSeries ?? []) {
    if (outer.dailyMetricTimeSeries) {
      // 実際のレスポンス形式: { dailyMetricTimeSeries: [...] }
      allSeries.push(...outer.dailyMetricTimeSeries)
    } else if (outer.dailyMetric && outer.timeSeries) {
      // フォールバック: 直下にある場合
      allSeries.push(outer as DailyMetricSeries)
    }
  }

  console.log(`[fetchPerformance] allSeries=${allSeries.length}`)

  // 日付をキーにしたマップに集約
  const byDate = new Map<string, Record<string, number | null>>()

  for (const series of allSeries) {
    const metric = series.dailyMetric as DailyMetric
    const colName = METRIC_TO_COLUMN[metric]
    if (!colName) continue

    for (const dv of series.timeSeries?.datedValues ?? []) {
      const { year, month, day } = dv.date
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      if (!byDate.has(dateStr)) byDate.set(dateStr, {})
      const row = byDate.get(dateStr)!
      const next = dv.value != null && dv.value !== '' ? Number(dv.value) : null
      const prev = row[colName] ?? null
      // 同一 dailyMetric の複数 DailyMetricTimeSeries（sub-entity 等）をマージ。
      // 上書きだと「一方だけ 0 の系列」で実数が消えるため、非 null 同士は max（重複系列の二重計上も避ける）。
      if (prev == null) {
        row[colName] = next
      } else if (next == null) {
        /* keep prev */
      } else {
        row[colName] = Math.max(prev, next)
      }
    }
  }

  return Array.from(byDate.entries()).map(([date, metrics]) => ({
    date,
    metrics,
    rawPayload: data,
  }))
}

// ------------------------------------------------
// 検索キーワード月次インプレッション（1カ月ずつ取得して月を確定）
// GET .../v1/{location}:searchkeywords/impressions/monthly
// ------------------------------------------------
export async function fetchSearchKeywordImpressionsMonthly(params: {
  accessToken:  string
  locationName: string // "locations/123..."
  year:         number
  month:        number // 1-12
}): Promise<GbpSearchKeywordMonthlyItem[]> {
  const { accessToken, locationName, year, month } = params
  const out: GbpSearchKeywordMonthlyItem[] = []
  let pageToken: string | undefined

  do {
    const query = new URLSearchParams()
    query.set('monthlyRange.start_month.year', String(year))
    query.set('monthlyRange.start_month.month', String(month))
    query.set('monthlyRange.end_month.year', String(year))
    query.set('monthlyRange.end_month.month', String(month))
    query.set('pageSize', '100')
    if (pageToken) query.set('pageToken', pageToken)

    const url = `${GBP_API_BASE}/v1/${locationName}/searchkeywords/impressions/monthly?${query}`
    const data = await gbpFetch(url, accessToken) as Record<string, unknown>
    const rows = (data.searchKeywordsCounts ?? data.search_keywords_counts) as Array<{
      searchKeyword?: string
      search_keyword?: string
      insightsValue?: { value?: string; threshold?: string }
      insights_value?: { value?: string; threshold?: string }
    }> | undefined
    const list = rows ?? []
    for (const row of list) {
      const kw = String(row.searchKeyword ?? row.search_keyword ?? '').trim()
      if (!kw) continue
      const iv = row.insightsValue ?? row.insights_value
      let impressions: number | null = null
      let threshold: string | null = null
      if (iv?.value != null && iv.value !== '') {
        const n = Number(iv.value)
        impressions = Number.isFinite(n) ? n : null
      } else if (iv?.threshold != null && iv.threshold !== '') {
        threshold = String(iv.threshold)
      }
      out.push({ searchKeyword: kw, impressions, threshold })
    }
    pageToken = (data.nextPageToken ?? data.next_page_token) as string | undefined
  } while (pageToken)

  return dedupeSearchKeywordMonthlyItems(out)
}

// ------------------------------------------------
// レビュー一覧を取得（全ページング）
// ------------------------------------------------
export async function fetchReviews(params: {
  accessToken:  string
  locationName: string   // "locations/123456789"
  accountName:  string   // "accounts/123456789"
}): Promise<GbpReview[]> {
  const reviews: GbpReview[] = []
  let pageToken: string | undefined

  // v4 API: accounts/{accountId}/locations/{locationId}/reviews
  const fullPath = `${params.accountName}/${params.locationName}`

  do {
    const query = new URLSearchParams({ pageSize: '50' })
    if (pageToken) query.set('pageToken', pageToken)

    const data = await gbpFetch(
      `https://mybusiness.googleapis.com/v4/${fullPath}/reviews?${query}`,
      params.accessToken
    ) as { reviews?: GbpReview[]; nextPageToken?: string }

    if (data.reviews) reviews.push(...data.reviews)
    pageToken = data.nextPageToken
  } while (pageToken)

  return reviews
}
