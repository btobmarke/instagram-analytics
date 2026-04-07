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

// ------------------------------------------------
// 共通フェッチ
// ------------------------------------------------
async function gbpFetch(url: string, accessToken: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.text()
    // 認証エラーは特別扱い（バッチ側でキャッチして auth_status=error に）
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`GBP API auth error: ${res.status} ${body}`)
      ;(err as Error & { isAuthError: boolean }).isAuthError = true
      throw err
    }
    throw new Error(`GBP API error: ${res.status} ${body}`)
  }
  return res.json()
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

  // 開始日
  query.set('dailyRange.startDate.year',  String(params.startDate.getFullYear()))
  query.set('dailyRange.startDate.month', String(params.startDate.getMonth() + 1))
  query.set('dailyRange.startDate.day',   String(params.startDate.getDate()))

  // 終了日
  query.set('dailyRange.endDate.year',  String(params.endDate.getFullYear()))
  query.set('dailyRange.endDate.month', String(params.endDate.getMonth() + 1))
  query.set('dailyRange.endDate.day',   String(params.endDate.getDate()))

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
      row[colName] = dv.value != null ? Number(dv.value) : null
    }
  }

  return Array.from(byDate.entries()).map(([date, metrics]) => ({
    date,
    metrics,
    rawPayload: data,
  }))
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
