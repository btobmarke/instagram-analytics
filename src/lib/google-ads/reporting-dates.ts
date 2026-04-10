/**
 * Google 広告の日次レポート用レンジ。
 * - 通常: 「昨日」まで（アカウント time_zone 基準）。当日分は含めない。
 * - 初回: 昨日を終端に backfill_days 日分（最大90）。
 * - 欠損: 前回同期成功時点で取りきった「昨日」の翌日から、今回の「昨日」までまとめて取得（最大90日にキャップ）。
 */

export function addCalendarDaysFromYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Invalid ymd: ${ymd}`)
  const ms = Date.UTC(y, m - 1, d + deltaDays)
  return new Date(ms).toISOString().slice(0, 10)
}

function safeTimeZone(raw: string | null | undefined): string {
  const t = (raw ?? '').trim() || 'Asia/Tokyo'
  try {
    Intl.DateTimeFormat(undefined, { timeZone: t }).format(new Date())
    return t
  } catch {
    return 'Asia/Tokyo'
  }
}

/** 指定タイムゾーンでの「その瞬間の暦日」yyyy-MM-dd */
export function getCalendarYmdInTimeZone(timeZone: string, instant: Date): string {
  const tz = safeTimeZone(timeZone)
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant)
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant)
  }
}

/** その瞬間のタイムゾーンにおける「昨日」 */
export function getYesterdayYmdRelativeToInstant(timeZone: string, instant: Date): string {
  const todayYmd = getCalendarYmdInTimeZone(timeZone, instant)
  return addCalendarDaysFromYmd(todayYmd, -1)
}

export type GoogleAdsSyncDateMode = 'initial_backfill' | 'incremental' | 'noop'

export function resolveGoogleAdsSyncDateRange(options: {
  timeZone: string | null | undefined
  lastSyncedAt: string | null
  backfillDays: number
  now?: Date
}): { start: string; end: string; mode: GoogleAdsSyncDateMode } {
  const tz = safeTimeZone(options.timeZone)
  const now = options.now ?? new Date()
  const end = getYesterdayYmdRelativeToInstant(tz, now)
  const backfill = Math.min(Math.max(options.backfillDays ?? 30, 1), 90)

  if (!options.lastSyncedAt) {
    const start = addCalendarDaysFromYmd(end, -(backfill - 1))
    return { start, end, mode: 'initial_backfill' }
  }

  const lastEnd = getYesterdayYmdRelativeToInstant(tz, new Date(options.lastSyncedAt))
  let start = addCalendarDaysFromYmd(lastEnd, 1)
  if (start > end) {
    return { start, end, mode: 'noop' }
  }

  const minStart = addCalendarDaysFromYmd(end, -89)
  if (start < minStart) start = minStart

  return { start, end, mode: 'incremental' }
}
