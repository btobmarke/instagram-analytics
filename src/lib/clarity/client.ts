/**
 * Microsoft Clarity Export API クライアント
 *
 * 認証方式: API キー（Bearer トークン）
 * ドキュメント: https://learn.microsoft.com/en-us/clarity/setup-and-installation/export-api
 */

const CLARITY_API_BASE = 'https://www.clarity.ms/export'

export interface ClarityDailyMetrics {
  totalSessionCount: number
  totalUserCount: number
  pagesPerSession: number
  activeTimeSecAvg: number
  scrollDepthAvgPct: number
  rageClickSessionCount: number
  deadClickSessionCount: number
  quickBackSessionCount: number
  excessiveScrollSessionCount: number
  jsErrorSessionCount: number
  botSessionCount: number
}

export interface ClarityPageMetrics {
  pageUrl: string
  sessionCount: number
  userCount: number
  scrollDepthAvgPct: number
  activeTimeSecAvg: number
  rageClicks: number
  deadClicks: number
  quickBacks: number
  jsErrors: number
}

export interface ClarityDeviceMetrics {
  deviceType: string
  browser: string
  os: string
  sessionCount: number
  userCount: number
}

// ---------------------------------------------------------------------------
// API 呼び出しヘルパー
// ---------------------------------------------------------------------------

async function clarityFetch(
  projectId: string,
  apiKey: string,
  endpoint: string,
  params: Record<string, string>
): Promise<unknown> {
  const qs = new URLSearchParams(params).toString()
  const url = `${CLARITY_API_BASE}/${projectId}/${endpoint}?${qs}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Clarity API エラー [${endpoint}]: ${res.status} ${err}`)
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// 日次サマリー取得
// ---------------------------------------------------------------------------

export async function fetchClarityDailySummary(
  projectId: string,
  apiKey: string,
  reportDate: string // YYYY-MM-DD
): Promise<ClarityDailyMetrics> {
  const data = (await clarityFetch(projectId, apiKey, 'metrics', {
    startDate: reportDate,
    endDate: reportDate,
    granularity: 'daily',
  })) as Record<string, unknown>

  // Clarity API レスポンスを正規化
  // レスポンス構造: { metrics: { totalSessionCount, totalUserCount, ... } }
  const m = (data?.metrics ?? data) as Record<string, number>

  return {
    totalSessionCount: Number(m.totalSessionCount ?? m.sessions ?? 0),
    totalUserCount: Number(m.totalUserCount ?? m.users ?? 0),
    pagesPerSession: Number(m.pagesPerSession ?? m.pageCount ?? 0),
    activeTimeSecAvg: Number(m.activeTimePerSessionSec ?? m.activeTime ?? 0),
    scrollDepthAvgPct: Number(m.scrollDepth ?? m.avgScrollDepth ?? 0),
    rageClickSessionCount: Number(m.rageClickCount ?? m.rageclickCount ?? 0),
    deadClickSessionCount: Number(m.deadClickCount ?? m.deadclickCount ?? 0),
    quickBackSessionCount: Number(m.quickBackCount ?? m.quickbackCount ?? 0),
    excessiveScrollSessionCount: Number(m.excessiveScrollCount ?? 0),
    jsErrorSessionCount: Number(m.jsErrorCount ?? 0),
    botSessionCount: Number(m.botSessionCount ?? m.bots ?? 0),
  }
}

// ---------------------------------------------------------------------------
// ページ別メトリクス取得
// ---------------------------------------------------------------------------

export async function fetchClarityPageMetrics(
  projectId: string,
  apiKey: string,
  reportDate: string
): Promise<ClarityPageMetrics[]> {
  const data = (await clarityFetch(projectId, apiKey, 'pages', {
    startDate: reportDate,
    endDate: reportDate,
    granularity: 'daily',
    pageSize: '500',
  })) as Record<string, unknown>

  const pages = (data?.pages ?? data?.data ?? []) as Record<string, unknown>[]

  return pages.map((p) => ({
    pageUrl: String(p.pageUrl ?? p.url ?? ''),
    sessionCount: Number(p.sessionCount ?? p.sessions ?? 0),
    userCount: Number(p.userCount ?? p.users ?? 0),
    scrollDepthAvgPct: Number(p.scrollDepth ?? p.avgScrollDepth ?? 0),
    activeTimeSecAvg: Number(p.activeTimePerSessionSec ?? p.activeTime ?? 0),
    rageClicks: Number(p.rageClickCount ?? p.rageclickCount ?? 0),
    deadClicks: Number(p.deadClickCount ?? p.deadclickCount ?? 0),
    quickBacks: Number(p.quickBackCount ?? p.quickbackCount ?? 0),
    jsErrors: Number(p.jsErrorCount ?? 0),
  }))
}

// ---------------------------------------------------------------------------
// デバイス別メトリクス取得
// ---------------------------------------------------------------------------

export async function fetchClarityDeviceMetrics(
  projectId: string,
  apiKey: string,
  reportDate: string
): Promise<ClarityDeviceMetrics[]> {
  const data = (await clarityFetch(projectId, apiKey, 'devices', {
    startDate: reportDate,
    endDate: reportDate,
    granularity: 'daily',
  })) as Record<string, unknown>

  const devices = (data?.devices ?? data?.data ?? []) as Record<string, unknown>[]

  return devices.map((d) => ({
    deviceType: String(d.deviceType ?? d.device ?? '(not set)'),
    browser: String(d.browser ?? '(not set)'),
    os: String(d.os ?? d.operatingSystem ?? '(not set)'),
    sessionCount: Number(d.sessionCount ?? d.sessions ?? 0),
    userCount: Number(d.userCount ?? d.users ?? 0),
  }))
}
