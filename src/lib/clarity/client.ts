/**
 * Microsoft Clarity Data Export API v1
 *
 * 認証: プロジェクトの Settings → Data Export で発行した API トークン（Bearer）
 * ドキュメント: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
 *
 * 注意:
 * - URL にプロジェクト ID は含めない（トークンがプロジェクトに紐づく）
 * - numOfDays は 1〜3 のみ（直近 24〜72 時間のローリング窓）。任意の過去日は取得不可
 */

const LIVE_INSIGHTS_URL = 'https://www.clarity.ms/export-data/api/v1/project-live-insights'

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

type LiveInsightBlock = { metricName?: string; information?: Record<string, unknown>[] }

function num(v: unknown): number {
  if (typeof v === 'number' && !isNaN(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, ''))
    return isNaN(n) ? 0 : n
  }
  return 0
}

/** targetDate に対し API が許す numOfDays (1|2|3)（UTC 日付差の目安） */
export function clarityNumOfDaysForTargetDate(targetDate: string): '1' | '2' | '3' {
  const target = new Date(`${targetDate}T12:00:00.000Z`).getTime()
  const diffDays = Math.floor((Date.now() - target) / (24 * 60 * 60 * 1000))
  if (diffDays <= 1) return '1'
  if (diffDays === 2) return '2'
  return '3'
}

async function fetchLiveInsights(
  apiKey: string,
  params: Record<string, string>
): Promise<LiveInsightBlock[]> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${LIVE_INSIGHTS_URL}?${qs}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Clarity API エラー [project-live-insights]: ${res.status} ${err}`)
  }

  const data = (await res.json()) as unknown
  if (!Array.isArray(data)) {
    throw new Error('Clarity API: レスポンスが配列ではありません')
  }
  return data as LiveInsightBlock[]
}

function findBlock(data: LiveInsightBlock[], re: RegExp): LiveInsightBlock | undefined {
  return data.find((b) => re.test(b.metricName ?? ''))
}

/** 主に Traffic 用。名称の前後空白差を吸収 */
function findTrafficBlock(data: LiveInsightBlock[]): LiveInsightBlock | undefined {
  return data.find((b) => (b.metricName ?? '').trim().toLowerCase() === 'traffic')
}

/** ブロック内の行をセッション数で重み付け平均（valueKey）、なければ行の単純合計（sumKey） */
function weightedAvgBySessions(
  block: LiveInsightBlock | undefined,
  valueKeys: string[],
  sessionKeys: string[] = ['totalSessionCount']
): number {
  if (!block?.information?.length) return 0
  let w = 0
  let acc = 0
  for (const row of block.information) {
    let s = 0
    for (const sk of sessionKeys) {
      if (sk in row) s += num(row[sk])
    }
    if (s <= 0) continue
    w += s
    let val = 0
    for (const vk of valueKeys) {
      if (vk in row) {
        val = num(row[vk])
        break
      }
    }
    acc += val * s
  }
  return w > 0 ? acc / w : 0
}

function sumMetricInBlock(
  block: LiveInsightBlock | undefined,
  keys: string[]
): number {
  if (!block?.information?.length) return 0
  let t = 0
  for (const row of block.information) {
    for (const k of keys) {
      if (k in row) t += num(row[k])
    }
  }
  return t
}

/**
 * 日次サマリー相当（ローリング窓）。projectId は互換のため受け取るが URL には使わない。
 */
export async function fetchClarityDailySummary(
  _projectId: string,
  apiKey: string,
  targetDate: string
): Promise<ClarityDailyMetrics> {
  const numDays = clarityNumOfDaysForTargetDate(targetDate)
  const data = await fetchLiveInsights(apiKey, {
    numOfDays: numDays,
    dimension1: 'OS',
  })

  const traffic = findTrafficBlock(data)
  let totalSessions = 0
  let totalBots = 0
  let totalUsers = 0
  let wPages = 0
  for (const row of traffic?.information ?? []) {
    const s = num(row.totalSessionCount)
    totalSessions += s
    totalBots += num(row.totalBotSessionCount)
    totalUsers += num(row.distantUserCount)
    wPages += num(row.PagesPerSessionPercentage) * s
  }
  const pagesPerSession = totalSessions > 0 ? wPages / totalSessions : 0

  const scrollDepthAvgPct = weightedAvgBySessions(findBlock(data, /scroll/i), [
    'ScrollDepth',
    'scrollDepth',
    'AvgScrollDepth',
  ])

  const activeTimeSecAvg = weightedAvgBySessions(findBlock(data, /engagement/i), [
    'EngagementTime',
    'engagementTime',
    'ActiveTime',
    'activeTime',
  ])

  const rageClickSessionCount = sumMetricInBlock(findBlock(data, /rage/i), [
    'rageClickCount',
    'RageClickCount',
  ])
  const deadClickSessionCount = sumMetricInBlock(findBlock(data, /dead/i), [
    'deadClickCount',
    'DeadClickCount',
  ])
  const quickBackSessionCount = sumMetricInBlock(findBlock(data, /quick/i), [
    'quickBackCount',
    'QuickBackCount',
  ])
  const excessiveScrollSessionCount = sumMetricInBlock(findBlock(data, /excessive/i), [
    'excessiveScrollCount',
    'ExcessiveScrollCount',
  ])
  const jsErrorSessionCount = sumMetricInBlock(findBlock(data, /script/i), [
    'scriptErrorCount',
    'ScriptErrorCount',
    'jsErrorCount',
  ])

  return {
    totalSessionCount: totalSessions,
    totalUserCount: totalUsers,
    pagesPerSession,
    activeTimeSecAvg,
    scrollDepthAvgPct,
    rageClickSessionCount,
    deadClickSessionCount,
    quickBackSessionCount,
    excessiveScrollSessionCount,
    jsErrorSessionCount,
    botSessionCount: totalBots,
  }
}

export async function fetchClarityPageMetrics(
  _projectId: string,
  apiKey: string,
  targetDate: string
): Promise<ClarityPageMetrics[]> {
  const numDays = clarityNumOfDaysForTargetDate(targetDate)
  const data = await fetchLiveInsights(apiKey, {
    numOfDays: numDays,
    dimension1: 'URL',
  })

  const block =
    findBlock(data, /popular/i) ??
    findTrafficBlock(data) ??
    data[0]

  const out: ClarityPageMetrics[] = []
  for (const row of block?.information ?? []) {
    const pageUrl = String(row.URL ?? row.url ?? row.pageUrl ?? '').trim()
    if (!pageUrl) continue
    out.push({
      pageUrl,
      sessionCount: num(row.totalSessionCount ?? row.sessionCount),
      userCount: num(row.distantUserCount ?? row.userCount),
      scrollDepthAvgPct: num(row.ScrollDepth ?? row.scrollDepth),
      activeTimeSecAvg: num(row.EngagementTime ?? row.engagementTime),
      rageClicks: num(row.rageClickCount ?? row.RageClickCount),
      deadClicks: num(row.deadClickCount ?? row.DeadClickCount),
      quickBacks: num(row.quickBackCount ?? row.QuickBackCount),
      jsErrors: num(row.scriptErrorCount ?? row.ScriptErrorCount ?? row.jsErrorCount),
    })
  }
  return out
}

export async function fetchClarityDeviceMetrics(
  _projectId: string,
  apiKey: string,
  targetDate: string
): Promise<ClarityDeviceMetrics[]> {
  const numDays = clarityNumOfDaysForTargetDate(targetDate)
  const data = await fetchLiveInsights(apiKey, {
    numOfDays: numDays,
    dimension1: 'Device',
  })

  const traffic = findTrafficBlock(data)
  const out: ClarityDeviceMetrics[] = []
  for (const row of traffic?.information ?? []) {
    out.push({
      deviceType: String(row.Device ?? row.deviceType ?? '(not set)'),
      browser: String(row.Browser ?? row.browser ?? '(not set)'),
      os: String(row.OS ?? row.os ?? '(not set)'),
      sessionCount: num(row.totalSessionCount),
      userCount: num(row.distantUserCount),
    })
  }
  return out
}
