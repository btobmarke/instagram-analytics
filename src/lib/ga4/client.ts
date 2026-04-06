/**
 * GA4 Data API v1 クライアント
 *
 * 認証方式: サービスアカウント JSON → RS256 JWT → OAuth2 アクセストークン
 * 外部パッケージ不要（Node.js 組み込み crypto のみ使用）
 */

import { createSign } from 'crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GA4_API_BASE = 'https://analyticsdata.googleapis.com/v1beta'
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

export interface ServiceAccountKey {
  type: string
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
}

/** サービスアカウント JSON 文字列を解析 */
export function parseServiceAccount(json: string): ServiceAccountKey {
  try {
    return JSON.parse(json) as ServiceAccountKey
  } catch {
    throw new Error('サービスアカウント JSON のパースに失敗しました')
  }
}

/** RS256 JWT を生成してアクセストークンを取得 */
export async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url')

  const signingInput = `${header}.${payload}`
  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  const signature = sign.sign(sa.private_key, 'base64url')
  const jwt = `${signingInput}.${signature}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GA4 トークン取得失敗: ${err}`)
  }

  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

// ---------------------------------------------------------------------------
// レポートリクエスト型
// ---------------------------------------------------------------------------

interface Dimension { name: string }
interface Metric { name: string }
interface DateRange { startDate: string; endDate: string }
interface ReportRequest {
  property: string
  dimensions: Dimension[]
  metrics: Metric[]
  dateRanges: DateRange[]
  limit?: number
  keepEmptyRows?: boolean
}

export interface ReportRow {
  dims: string[]
  metrics: string[]
}

/** GA4 Data API runReport を実行 */
export async function runReport(
  propertyId: string,
  accessToken: string,
  params: Omit<ReportRequest, 'property'>
): Promise<ReportRow[]> {
  const body: ReportRequest = {
    property: `properties/${propertyId}`,
    ...params,
    limit: params.limit ?? 10000,
  }

  const res = await fetch(`${GA4_API_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GA4 runReport 失敗: ${res.status} ${err}`)
  }

  const data = await res.json()
  const rows: ReportRow[] = (data.rows ?? []).map((row: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }) => ({
    dims: row.dimensionValues.map((d) => d.value),
    metrics: row.metricValues.map((m) => m.value),
  }))
  return rows
}

// ---------------------------------------------------------------------------
// 各種レポート取得関数
// ---------------------------------------------------------------------------

/** 日次サマリー取得（プロパティ全体） */
export async function fetchDailySummary(
  propertyId: string,
  accessToken: string,
  reportDate: string
): Promise<ReportRow[]> {
  return runReport(propertyId, accessToken, {
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'returningUsers' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'sessionsPerUser' },
      { name: 'screenPageViews' },
      { name: 'screenPageViewsPerSession' },
      { name: 'conversions' },
      { name: 'totalRevenue' },
    ],
    dateRanges: [{ startDate: reportDate, endDate: reportDate }],
  })
}

/** ページ別メトリクス取得 */
export async function fetchPageMetrics(
  propertyId: string,
  accessToken: string,
  reportDate: string
): Promise<ReportRow[]> {
  return runReport(propertyId, accessToken, {
    dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'engagedSessions' },
      { name: 'userEngagementDuration' },
      { name: 'bounceRate' },
      { name: 'entrances' },
      { name: 'exits' },
      { name: 'conversions' },
    ],
    dateRanges: [{ startDate: reportDate, endDate: reportDate }],
    limit: 500,
  })
}

/** トラフィックソース別取得 */
export async function fetchTrafficSources(
  propertyId: string,
  accessToken: string,
  reportDate: string
): Promise<ReportRow[]> {
  return runReport(propertyId, accessToken, {
    dimensions: [
      { name: 'sessionSource' },
      { name: 'sessionMedium' },
      { name: 'sessionCampaignName' },
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'engagedSessions' },
      { name: 'conversions' },
      { name: 'totalRevenue' },
    ],
    dateRanges: [{ startDate: reportDate, endDate: reportDate }],
    limit: 500,
  })
}

/** イベント別取得 */
export async function fetchEventMetrics(
  propertyId: string,
  accessToken: string,
  reportDate: string
): Promise<ReportRow[]> {
  return runReport(propertyId, accessToken, {
    dimensions: [{ name: 'eventName' }],
    metrics: [
      { name: 'eventCount' },
      { name: 'totalUsers' },
      { name: 'conversions' },
      { name: 'eventValue' },
    ],
    dateRanges: [{ startDate: reportDate, endDate: reportDate }],
    limit: 200,
  })
}

/** デバイス別取得 */
export async function fetchDeviceMetrics(
  propertyId: string,
  accessToken: string,
  reportDate: string
): Promise<ReportRow[]> {
  return runReport(propertyId, accessToken, {
    dimensions: [
      { name: 'deviceCategory' },
      { name: 'operatingSystem' },
      { name: 'browser' },
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'conversions' },
    ],
    dateRanges: [{ startDate: reportDate, endDate: reportDate }],
  })
}

/** 地域別取得 */
export async function fetchGeoMetrics(
  propertyId: string,
  accessToken: string,
  reportDate: string
): Promise<ReportRow[]> {
  return runReport(propertyId, accessToken, {
    dimensions: [
      { name: 'country' },
      { name: 'region' },
      { name: 'city' },
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'conversions' },
    ],
    dateRanges: [{ startDate: reportDate, endDate: reportDate }],
    limit: 500,
  })
}
