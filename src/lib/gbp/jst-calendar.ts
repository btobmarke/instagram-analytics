/**
 * GBP 日次バッチの日付窓を JST 基準に揃える（Vercel 等でプロセスが UTC のとき
 * `new Date(ms + 9h).getDate()` が JST と 1 日ズレるのを防ぐ）。
 */

export function jstTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year:    'numeric',
    month:   '2-digit',
    day:     '2-digit',
  }).format(new Date())
}

/** YYYY-MM-DD のカレンダー日に delta 日加算（負可） */
export function addCalendarDaysIso(ymd: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) throw new Error(`addCalendarDaysIso: invalid ymd "${ymd}"`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))
  t.setUTCDate(t.getUTCDate() + delta)
  return t.toISOString().slice(0, 10)
}

export function ymdToParts(ymd: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) throw new Error(`ymdToParts: invalid ymd "${ymd}"`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/** カレンダー日 Y-M-D を UTC 午前0時の Date に（fetchPerformance の getUTC* と対） */
export function utcDateFromYmd(ymd: string): Date {
  const { year, month, day } = ymdToParts(ymd)
  return new Date(Date.UTC(year, month - 1, day))
}
