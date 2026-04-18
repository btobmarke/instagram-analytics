import type { SupabaseClient } from '@supabase/supabase-js'

export type DashboardPeriod = '7d' | '30d' | '90d'

const IG_BATCH_JOBS = [
  'daily_media_collector',
  'hourly_story_media_collector',
  'hourly_media_insight_collector',
  'hourly_story_insight_collector',
] as const

function periodDays(p: DashboardPeriod): number {
  return p === '7d' ? 7 : p === '30d' ? 30 : 90
}

function addDays(isoDate: string, delta: number): string {
  const d = new Date(isoDate + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export function dashboardDateRanges(period: DashboardPeriod) {
  const days = periodDays(period)
  const until = new Date().toISOString().slice(0, 10)
  const since = addDays(until, -days)
  const prevUntil = addDays(since, -1)
  const prevSince = addDays(prevUntil, -(days - 1))
  return { days, since, until, prevSince, prevUntil }
}

function isAggregateDailyRow(row: { dimension_code: string | null }): boolean {
  return !row.dimension_code || row.dimension_code === ''
}

/** 日次アカウント指標（breakdown なし行）を期間で合計 */
async function sumAccountMetrics(
  supabase: SupabaseClient,
  accountId: string,
  since: string,
  until: string,
  metricCodes: string[]
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('ig_account_insight_fact')
    .select('metric_code, value, dimension_code')
    .eq('account_id', accountId)
    .in('metric_code', metricCodes)
    .gte('value_date', since)
    .lte('value_date', until)

  const sums: Record<string, number> = {}
  for (const code of metricCodes) sums[code] = 0
  for (const row of data ?? []) {
    if (!isAggregateDailyRow(row)) continue
    const v = row.value
    if (typeof v !== 'number') continue
    sums[row.metric_code] = (sums[row.metric_code] ?? 0) + v
  }
  return sums
}

async function followerEndpoints(
  supabase: SupabaseClient,
  accountId: string,
  since: string,
  until: string
): Promise<{ start: number | null; end: number | null }> {
  const { data } = await supabase
    .from('ig_account_insight_fact')
    .select('value_date, value, dimension_code')
    .eq('account_id', accountId)
    .eq('metric_code', 'follower_count')
    .gte('value_date', since)
    .lte('value_date', until)
    .order('value_date', { ascending: true })

  const plain = (data ?? []).filter(isAggregateDailyRow)
  if (!plain.length) return { start: null, end: null }
  const start = typeof plain[0].value === 'number' ? plain[0].value : null
  const last = plain[plain.length - 1]
  const end = typeof last.value === 'number' ? last.value : null
  return { start, end }
}

async function postTypeCounts(
  supabase: SupabaseClient,
  accountId: string,
  since: string,
  until: string
): Promise<{ total: number; feed: number; reels: number; story: number }> {
  const { data: posts } = await supabase
    .from('ig_media')
    .select('media_product_type')
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .gte('posted_at', since + 'T00:00:00Z')
    .lte('posted_at', until + 'T23:59:59Z')

  const list = posts ?? []
  return {
    total: list.length,
    feed: list.filter(p => p.media_product_type === 'FEED').length,
    reels: list.filter(p => p.media_product_type === 'REELS').length,
    story: list.filter(p => p.media_product_type === 'STORY').length,
  }
}

function latestInsightsMap(
  rows: Array<{ metric_code: string; value: number | null; snapshot_at: string }>
): Record<string, number | null> {
  const newestByMetric: Record<string, { value: number | null; snapshot_at: string }> = {}
  for (const ins of rows) {
    const prev = newestByMetric[ins.metric_code]
    if (!prev || ins.snapshot_at > prev.snapshot_at) {
      newestByMetric[ins.metric_code] = { value: ins.value, snapshot_at: ins.snapshot_at }
    }
  }
  const latest: Record<string, number | null> = {}
  for (const [code, row] of Object.entries(newestByMetric)) {
    latest[code] = row.value
  }
  return latest
}

function reachScore(insights: Record<string, number | null>): number {
  const r = insights.reach
  if (typeof r === 'number') return r
  const v = insights.views ?? insights.impressions
  return typeof v === 'number' ? v : 0
}

export type DashboardFreshness = {
  media_updated_at: string | null
  account_insight_fetched_at: string | null
  media_insight_snapshot_at: string | null
  story_insight_fetched_at: string | null
  active_story_count: number
  batch_runs: Array<{ job_name: string; status: string; finished_at: string | null; started_at: string }>
}

export type PeriodBlock = {
  since: string
  until: string
  metrics: Record<string, number>
  follower_start: number | null
  follower_end: number | null
  posts: { total: number; feed: number; reels: number; story: number }
}

export type PeriodCompare = {
  current: PeriodBlock
  previous: PeriodBlock
  delta: {
    reach: number | null
    views: number | null
    profile_views: number | null
    follower_net: number | null
    posts_total: number | null
  }
}

export type DashboardTopPost = {
  id: string
  posted_at: string
  media_product_type: string | null
  caption: string | null
  thumbnail_url: string | null
  permalink: string | null
  reach: number | null
  views: number | null
  likes: number | null
  saves: number | null
  comments: number | null
}

export type DashboardStoryCard = {
  id: string
  posted_at: string
  thumbnail_url: string | null
  permalink: string | null
  reach: number | null
  views: number | null
  navigation_exits: number | null
}

export type DemographicSlice = {
  metric: 'follower_demographics' | 'engaged_audience_demographics'
  breakdown: string
  rows: Array<{ label: string; value: number }>
  as_of_date: string | null
}

export type ProfileActivityAggregate = {
  by_action: Array<{ code: string; label: string; value: number }>
}

export interface InstagramDashboardResponse {
  period: DashboardPeriod
  periodCompare: PeriodCompare
  freshness: DashboardFreshness
  top_posts: DashboardTopPost[]
  active_stories: DashboardStoryCard[]
  demographics: DemographicSlice[]
  profile_activity_posts: ProfileActivityAggregate
}

export async function buildInstagramDashboardData(
  supabase: SupabaseClient,
  accountId: string,
  period: DashboardPeriod
): Promise<InstagramDashboardResponse> {
  const { since, until, prevSince, prevUntil } = dashboardDateRanges(period)
  const metricCodes = ['reach', 'views', 'profile_views'] as const

  const [
    freshness,
    currentMetrics,
    previousMetrics,
    curFollow,
    prevFollow,
    curPosts,
    prevPosts,
    topPosts,
    storyCards,
    demographics,
    profileActivity,
  ] = await Promise.all([
    buildFreshness(supabase, accountId),
    sumAccountMetrics(supabase, accountId, since, until, [...metricCodes]),
    sumAccountMetrics(supabase, accountId, prevSince, prevUntil, [...metricCodes]),
    followerEndpoints(supabase, accountId, since, until),
    followerEndpoints(supabase, accountId, prevSince, prevUntil),
    postTypeCounts(supabase, accountId, since, until),
    postTypeCounts(supabase, accountId, prevSince, prevUntil),
    buildTopPosts(supabase, accountId, since, until),
    buildStoryCards(supabase, accountId),
    buildDemographics(supabase, accountId),
    buildProfileActivityFromMedia(supabase, accountId),
  ])

  const delta = {
    reach: diffRate(currentMetrics.reach, previousMetrics.reach),
    views: diffRate(currentMetrics.views, previousMetrics.views),
    profile_views: diffRate(currentMetrics.profile_views, previousMetrics.profile_views),
    follower_net: diffNullable(
      curFollow.end != null && curFollow.start != null ? curFollow.end - curFollow.start : null,
      prevFollow.end != null && prevFollow.start != null ? prevFollow.end - prevFollow.start : null
    ),
    posts_total: diffNullable(curPosts.total, prevPosts.total),
  }

  const periodCompare: PeriodCompare = {
    current: {
      since,
      until,
      metrics: currentMetrics,
      follower_start: curFollow.start,
      follower_end: curFollow.end,
      posts: curPosts,
    },
    previous: {
      since: prevSince,
      until: prevUntil,
      metrics: previousMetrics,
      follower_start: prevFollow.start,
      follower_end: prevFollow.end,
      posts: prevPosts,
    },
    delta,
  }

  return {
    period,
    periodCompare,
    freshness,
    top_posts: topPosts,
    active_stories: storyCards,
    demographics,
    profile_activity_posts: profileActivity,
  }
}

function diffRate(cur: number, prev: number): number | null {
  if (prev === 0 && cur === 0) return null
  if (prev === 0) return null
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

function diffNullable(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null
  return cur - prev
}

async function buildFreshness(
  supabase: SupabaseClient,
  accountId: string
): Promise<DashboardFreshness> {
  const { data: mediaRow } = await supabase
    .from('ig_media')
    .select('updated_at')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: acctInsightRow } = await supabase
    .from('ig_account_insight_fact')
    .select('fetched_at')
    .eq('account_id', accountId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: mediaIds } = await supabase.from('ig_media').select('id').eq('account_id', accountId)
  const ids = (mediaIds ?? []).map(r => r.id)
  let mediaInsightSnapshotAt: string | null = null
  if (ids.length) {
    const chunk = ids.slice(0, 3000)
    const { data: insRow } = await supabase
      .from('ig_media_insight_fact')
      .select('snapshot_at')
      .in('media_id', chunk)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    mediaInsightSnapshotAt = insRow?.snapshot_at ?? null
  }

  const storySince = new Date(Date.now() - 48 * 3600000).toISOString()
  const { data: storyMediaIds } = await supabase
    .from('ig_media')
    .select('id')
    .eq('account_id', accountId)
    .eq('media_product_type', 'STORY')
    .gte('posted_at', storySince)

  const sid = (storyMediaIds ?? []).map(r => r.id)
  let storyInsightFetchedAt: string | null = null
  if (sid.length) {
    const { data: sRow } = await supabase
      .from('ig_story_insight_fact')
      .select('fetched_at')
      .in('media_id', sid.slice(0, 500))
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    storyInsightFetchedAt = sRow?.fetched_at ?? null
  }

  const { count: activeStoryCount } = await supabase
    .from('ig_media')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('media_product_type', 'STORY')
    .eq('is_deleted', false)
    .gte('posted_at', new Date(Date.now() - 24 * 3600000).toISOString())

  const { data: logs } = await supabase
    .from('batch_job_logs')
    .select('job_name, status, finished_at, started_at')
    .in('job_name', [...IG_BATCH_JOBS])
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(48)

  const seen = new Set<string>()
  const batch_runs: DashboardFreshness['batch_runs'] = []
  for (const row of logs ?? []) {
    if (seen.has(row.job_name)) continue
    seen.add(row.job_name)
    batch_runs.push({
      job_name: row.job_name,
      status: row.status,
      finished_at: row.finished_at,
      started_at: row.started_at,
    })
  }

  return {
    media_updated_at: mediaRow?.updated_at ?? null,
    account_insight_fetched_at: acctInsightRow?.fetched_at ?? null,
    media_insight_snapshot_at: mediaInsightSnapshotAt,
    story_insight_fetched_at: storyInsightFetchedAt,
    active_story_count: activeStoryCount ?? 0,
    batch_runs,
  }
}

async function buildTopPosts(
  supabase: SupabaseClient,
  accountId: string,
  since: string,
  until: string
): Promise<DashboardTopPost[]> {
  const { data: posts } = await supabase
    .from('ig_media')
    .select(`
      id, posted_at, media_product_type, caption, thumbnail_url, permalink,
      ig_media_insight_fact(metric_code, value, snapshot_at)
    `)
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .gte('posted_at', since + 'T00:00:00Z')
    .lte('posted_at', until + 'T23:59:59Z')
    .order('posted_at', { ascending: false })
    .limit(120)

  const nonStory = (posts ?? []).filter(p => p.media_product_type !== 'STORY').slice(0, 80)

  const scored = nonStory.map((p) => {
    const raw = p.ig_media_insight_fact as
      | Array<{ metric_code: string; value: number | null; snapshot_at: string }>
      | null
      | undefined
    const insights = latestInsightsMap(raw ?? [])
    const { ig_media_insight_fact: _, ...rest } = p as Record<string, unknown>
    return {
      ...rest,
      insights,
      _score: reachScore(insights),
    } as DashboardTopPost & { insights: Record<string, number | null>; _score: number }
  })

  scored.sort((a, b) => b._score - a._score)
  return scored.slice(0, 6).map(({ insights, _score, ...post }) => ({
    id: post.id,
    posted_at: post.posted_at,
    media_product_type: post.media_product_type,
    caption: post.caption,
    thumbnail_url: post.thumbnail_url,
    permalink: post.permalink,
    reach: insights.reach ?? null,
    views: insights.views ?? insights.impressions ?? null,
    likes: insights.likes ?? null,
    saves: insights.saved ?? insights.saves ?? null,
    comments: insights.comments ?? null,
  }))
}

async function buildStoryCards(
  supabase: SupabaseClient,
  accountId: string
): Promise<DashboardStoryCard[]> {
  const since = new Date(Date.now() - 36 * 3600000).toISOString()
  const { data: stories } = await supabase
    .from('ig_media')
    .select(`
      id, posted_at, thumbnail_url, permalink,
      ig_story_insight_fact(metric_code, value, fetched_at)
    `)
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .eq('media_product_type', 'STORY')
    .gte('posted_at', since)
    .order('posted_at', { ascending: false })
    .limit(12)

  return (stories ?? []).map((s) => {
    const raw = s.ig_story_insight_fact as
      | Array<{ metric_code: string; value: number | null; fetched_at: string }>
      | null
      | undefined
    const byMetric: Record<string, { value: number | null; fetched_at: string }> = {}
    for (const row of raw ?? []) {
      const prev = byMetric[row.metric_code]
      if (!prev || row.fetched_at > prev.fetched_at) {
        byMetric[row.metric_code] = { value: row.value, fetched_at: row.fetched_at }
      }
    }
    const get = (code: string) => byMetric[code]?.value ?? null
    return {
      id: s.id,
      posted_at: s.posted_at,
      thumbnail_url: s.thumbnail_url,
      permalink: s.permalink,
      reach: get('reach'),
      views: get('views') ?? get('impressions'),
      navigation_exits: get('navigation_tap_exit'),
    }
  })
}

export const DEMO_BREAKDOWN_LABELS: Record<string, string> = {
  gender: '性別',
  age: '年齢',
  country: '国',
  city: '都市',
}

function humanizeDemoValue(breakdown: string, value: string): string {
  if (breakdown === 'gender') {
    if (value === 'FEMALE') return '女性'
    if (value === 'MALE') return '男性'
    if (value === 'U') return '不明'
  }
  return value
}

async function buildDemographics(
  supabase: SupabaseClient,
  accountId: string
): Promise<DemographicSlice[]> {
  const { data: rows } = await supabase
    .from('ig_account_insight_fact')
    .select('metric_code, dimension_code, dimension_value, value, value_date')
    .eq('account_id', accountId)
    .in('metric_code', ['follower_demographics', 'engaged_audience_demographics'])
    .eq('period_code', 'lifetime')
    .order('value_date', { ascending: false })
    .limit(400)

  const list = rows ?? []
  if (!list.length) return []

  const maxDate = list.reduce<string | null>((m, r) => {
    if (!r.value_date) return m
    if (!m || r.value_date > m) return r.value_date
    return m
  }, null)
  const fresh = list.filter(r => r.value_date === maxDate && r.dimension_code && r.dimension_value)

  const out: DemographicSlice[] = []
  const metrics = ['follower_demographics', 'engaged_audience_demographics'] as const
  for (const metric of metrics) {
    const breakdowns = new Set(
      fresh.filter(r => r.metric_code === metric).map(r => r.dimension_code as string)
    )
    for (const breakdown of breakdowns) {
      const sliceRows = fresh
        .filter(r => r.metric_code === metric && r.dimension_code === breakdown)
        .map(r => ({
          label: humanizeDemoValue(breakdown, String(r.dimension_value)),
          value: typeof r.value === 'number' ? r.value : 0,
        }))
        .filter(r => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)

      if (sliceRows.length) {
        out.push({
          metric,
          breakdown,
          rows: sliceRows,
          as_of_date: maxDate ?? null,
        })
      }
    }
  }

  return out.sort((a, b) => {
    const order = (x: string) => (['gender', 'age', 'country', 'city'].indexOf(x) + 1) || 99
    if (a.metric !== b.metric) return a.metric.localeCompare(b.metric)
    return order(a.breakdown) - order(b.breakdown)
  })
}

const PROFILE_ACTION_LABELS: Record<string, string> = {
  bio_link_click: 'リンクタップ',
  call: '電話',
  direction: '道順',
  email: 'メール',
  text_message: 'SMS',
  address: '住所',
  website_click: 'Webサイト',
}

async function buildProfileActivityFromMedia(
  supabase: SupabaseClient,
  accountId: string
): Promise<ProfileActivityAggregate> {
  const { data: mediaIds } = await supabase
    .from('ig_media')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .order('posted_at', { ascending: false })
    .limit(400)

  const ids = (mediaIds ?? []).map(r => r.id)
  if (!ids.length) return { by_action: [] }

  const { data: facts } = await supabase
    .from('ig_media_insight_fact')
    .select('media_id, metric_code, value, snapshot_at')
    .in('media_id', ids)
    .like('metric_code', 'profile_activity_%')

  const latestPerMediaMetric: Record<string, { value: number; snapshot_at: string }> = {}
  for (const row of facts ?? []) {
    const key = `${row.media_id}::${row.metric_code}`
    const v = typeof row.value === 'number' ? row.value : 0
    const prev = latestPerMediaMetric[key]
    if (!prev || row.snapshot_at > prev.snapshot_at) {
      latestPerMediaMetric[key] = { value: v, snapshot_at: row.snapshot_at }
    }
  }

  const sumByCode: Record<string, number> = {}
  for (const [key, { value }] of Object.entries(latestPerMediaMetric)) {
    const code = key.split('::')[1] ?? ''
    if (!code.startsWith('profile_activity_')) continue
    sumByCode[code] = (sumByCode[code] ?? 0) + value
  }

  const by_action = Object.entries(sumByCode)
    .map(([code, value]) => {
      const tail = code.replace('profile_activity_', '')
      return {
        code,
        label: PROFILE_ACTION_LABELS[tail] ?? tail,
        value,
      }
    })
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)

  return { by_action }
}
