/**
 * Cron グループ（案A: 時間帯ベース）の定義。
 * Vercel Cron は UTC。スケジュールは従来 vercel.json の式と同一の UTC 解釈。
 */

export const CRON_GROUP_IDS = [
  'g2',
  'g3',
  'g4',
  'g_hourly',
  'g_halfhour',
  'g_weekly',
  'g_daily_misc',
] as const

export type CronGroupId = (typeof CRON_GROUP_IDS)[number]

/** 1 ジョブの発火条件（UTC） */
export type UtcTimeMatch =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'hourly'; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number } // 0=日 … 6=土（Date#getUTCDay）

export type CronGroupJob = {
  /** /api/batch/{slug} の slug */
  slug: string
  /** このグループの Cron が鳴ったとき、今回の UTC 時刻に実行するか */
  schedule: UtcTimeMatch
}

export type CronGroupDefinition = {
  id: CronGroupId
  label: string
  /** vercel.json の schedule（UTC） */
  vercelSchedule: string
  jobs: CronGroupJob[]
}

/**
 * G2: 深夜メディア・広告系 — Cron: 0,15,30 2 * * *
 * （旧: lp-aggregate 0 2, google-ads-daily 15 2, media-collector 30 2）
 */
const G2: CronGroupDefinition = {
  id: 'g2',
  label: '深夜メディア・広告系（02:00台 UTC）',
  vercelSchedule: '0,15,30 2 * * *',
  jobs: [
    { slug: 'lp-aggregate', schedule: { kind: 'daily', hour: 2, minute: 0 } },
    { slug: 'google-ads-daily', schedule: { kind: 'daily', hour: 2, minute: 15 } },
    { slug: 'media-collector', schedule: { kind: 'daily', hour: 2, minute: 30 } },
  ],
}

/**
 * G3: 深夜アナリティクス系 — Cron: 15,45 3 * * *
 */
const G3: CronGroupDefinition = {
  id: 'g3',
  label: '深夜アナリティクス系（03:00台 UTC）',
  vercelSchedule: '15,45 3 * * *',
  jobs: [
    { slug: 'ga4-collector', schedule: { kind: 'daily', hour: 3, minute: 15 } },
    { slug: 'clarity-collector', schedule: { kind: 'daily', hour: 3, minute: 45 } },
  ],
}

/**
 * G4: 早朝ローカル・LINE系 — Cron: 0,30 4 * * *
 */
const G4: CronGroupDefinition = {
  id: 'g4',
  label: '早朝ローカル・LINE系（04:00台 UTC）',
  vercelSchedule: '0,30 4 * * *',
  jobs: [
    { slug: 'gbp-daily', schedule: { kind: 'daily', hour: 4, minute: 0 } },
    { slug: 'line-oam-daily', schedule: { kind: 'daily', hour: 4, minute: 30 } },
  ],
}

/**
 * G_hourly: SNS・KPI系 — Cron: 0,5,10,45 * * * *
 */
const G_HOURLY: CronGroupDefinition = {
  id: 'g_hourly',
  label: 'SNS・KPI系（毎時 UTC）',
  vercelSchedule: '0,5,10,45 * * * *',
  jobs: [
    { slug: 'insight-collector', schedule: { kind: 'hourly', minute: 0 } },
    { slug: 'story-media-collector', schedule: { kind: 'hourly', minute: 5 } },
    { slug: 'story-insight-collector', schedule: { kind: 'hourly', minute: 10 } },
    { slug: 'kpi-calc', schedule: { kind: 'hourly', minute: 45 } },
  ],
}

/** G_halfhour: メンテ系（:00 / :30 の両方で lp-session-cleanup） */
const G_HALFHOUR: CronGroupDefinition = {
  id: 'g_halfhour',
  label: 'メンテ系（30分 UTC）',
  vercelSchedule: '*/30 * * * *',
  jobs: [
    { slug: 'lp-session-cleanup', schedule: { kind: 'hourly', minute: 0 } },
    { slug: 'lp-session-cleanup', schedule: { kind: 'hourly', minute: 30 } },
  ],
}

/**
 * G_weekly: 週次 — Cron: 0,30 6,7 * * 1（月曜 UTC の 6:00/6:30/7:00/7:30 のうち該当のみ実行）
 * 旧: ai-analysis 0 6 * * 1, instagram-velocity-retro 30 7 * * 1
 */
const G_WEEKLY: CronGroupDefinition = {
  id: 'g_weekly',
  label: '週次AI・Instagram（月曜 UTC）',
  vercelSchedule: '0,30 6,7 * * 1',
  jobs: [
    { slug: 'ai-analysis', schedule: { kind: 'weekly', weekday: 1, hour: 6, minute: 0 } },
    {
      slug: 'instagram-velocity-retro',
      schedule: { kind: 'weekly', weekday: 1, hour: 7, minute: 30 },
    },
  ],
}

/**
 * G_daily_misc — Cron: 0 0,12,17,21 * * *
 * 旧: weather-sync 0 0,12, external-data 0 17, project-metrics-aggregate 0 21
 */
const G_DAILY_MISC: CronGroupDefinition = {
  id: 'g_daily_misc',
  label: 'その他日次（UTC）',
  vercelSchedule: '0 0,12,17,21 * * *',
  jobs: [
    { slug: 'weather-sync', schedule: { kind: 'daily', hour: 0, minute: 0 } },
    { slug: 'weather-sync', schedule: { kind: 'daily', hour: 12, minute: 0 } },
    { slug: 'external-data', schedule: { kind: 'daily', hour: 17, minute: 0 } },
    { slug: 'project-metrics-aggregate', schedule: { kind: 'daily', hour: 21, minute: 0 } },
  ],
}

export const CRON_GROUP_LIST: CronGroupDefinition[] = [
  G2,
  G3,
  G4,
  G_HOURLY,
  G_HALFHOUR,
  G_WEEKLY,
  G_DAILY_MISC,
]

export const CRON_GROUPS: Record<CronGroupId, CronGroupDefinition> = {
  g2: G2,
  g3: G3,
  g4: G4,
  g_hourly: G_HOURLY,
  g_halfhour: G_HALFHOUR,
  g_weekly: G_WEEKLY,
  g_daily_misc: G_DAILY_MISC,
}

export function isCronGroupId(s: string): s is CronGroupId {
  return (CRON_GROUP_IDS as readonly string[]).includes(s)
}

function matchesUtc(now: Date, m: UtcTimeMatch): boolean {
  const wd = now.getUTCDay()
  const h = now.getUTCHours()
  const min = now.getUTCMinutes()

  switch (m.kind) {
    case 'daily':
      return h === m.hour && min === m.minute
    case 'hourly':
      return min === m.minute
    case 'weekly':
      return wd === m.weekday && h === m.hour && min === m.minute
    default: {
      const _exhaustive: never = m
      return _exhaustive
    }
  }
}

/**
 * このグループの Cron が今鳴ったタイミングで、実行すべきバッチ slug 一覧（重複なし・定義順）
 */
export function getDueBatchSlugs(groupId: CronGroupId, now: Date = new Date()): string[] {
  const def = CRON_GROUPS[groupId]
  const out: string[] = []
  const seen = new Set<string>()
  for (const job of def.jobs) {
    if (matchesUtc(now, job.schedule) && !seen.has(job.slug)) {
      seen.add(job.slug)
      out.push(job.slug)
    }
  }
  return out
}

export function getCronGroupDefinition(groupId: CronGroupId): CronGroupDefinition {
  return CRON_GROUPS[groupId]
}
