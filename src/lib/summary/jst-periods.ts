/**
 * サマリーの「日」軸を Asia/Tokyo の暦日で揃える。
 * - Vercel(UTC) とブラウザ(JST) の「今日」ずれを防ぐ
 * - DATE 型 value_date と new Date('YYYY-MM-DD') の UTC 解釈ずれを防ぐ（dateKey で文字列一致）
 */

const TZ = 'Asia/Tokyo'

/** その瞬間の JST 暦日 YYYY-MM-DD */
export function formatDateKeyJst(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** JST の日付キーから n 日ずらす（日本は DST なしのため 24h 加算で十分） */
export function addDaysToJstDateKey(dateKey: string, deltaDays: number): string {
  const base = new Date(`${dateKey}T12:00:00+09:00`)
  return formatDateKeyJst(new Date(base.getTime() + deltaDays * 86400000))
}

export interface JstDayPeriod {
  label: string
  start: Date
  end: Date
  /** YYYY-MM-DD（ig_account_insight_fact.value_date 等と一致） */
  dateKey: string
}

/**
 * 今日を含む直近 count 日（JST）。古い日が先頭、今日が末尾（既存 generatePeriods と同じ順序）
 */
export function generateJstDayPeriods(count: number, now: Date = new Date()): JstDayPeriod[] {
  const periods: JstDayPeriod[] = []
  const todayKey = formatDateKeyJst(now)
  for (let i = count - 1; i >= 0; i--) {
    const dateKey = addDaysToJstDateKey(todayKey, -i)
    const start = new Date(`${dateKey}T00:00:00+09:00`)
    const end = new Date(start.getTime() + 86400000)
    const [, mm, dd] = dateKey.split('-')
    const label = `${Number(mm)}/${Number(dd)}`
    periods.push({ label, start, end, dateKey })
  }
  return periods
}

/**
 * JST の日付範囲（両端含む）から日次 period を生成する。
 * 例: 2026-04-01 〜 2026-04-03 → 3日分。
 */
export function generateJstDayPeriodsFromRange(rangeStart: string, rangeEnd: string): JstDayPeriod[] {
  const startKey = rangeStart.slice(0, 10)
  const endKey = rangeEnd.slice(0, 10)
  const periods: JstDayPeriod[] = []
  if (startKey > endKey) return periods

  let cur = startKey
  while (cur <= endKey) {
    const start = new Date(`${cur}T00:00:00+09:00`)
    const end = new Date(start.getTime() + 86400000)
    const [, mm, dd] = cur.split('-')
    const label = `${Number(mm)}/${Number(dd)}`
    periods.push({ label, start, end, dateKey: cur })
    cur = addDaysToJstDateKey(cur, 1)
  }
  return periods
}

/** テーブルヘッダ用ラベル列（API の data キーと同一） */
export function generateJstDayPeriodLabels(count: number, now?: Date): string[] {
  return generateJstDayPeriods(count, now).map(p => p.label)
}

/** YYYY-MM-DD を YYYYMMDD に */
export function toYmdCompact(isoDate: string): string {
  return isoDate.slice(0, 10).replace(/-/g, '')
}

export interface CustomRangePeriod {
  label: string
  start: Date
  end: Date
  rangeStart: string
  rangeEnd: string
}

/**
 * 横軸1列: ラベルは 20240401~20240410 形式（JST 暦日の開始・終了を含む）
 */
export function generateCustomRangePeriod(rangeStartYmd: string, rangeEndYmd: string): CustomRangePeriod {
  const rs = rangeStartYmd.slice(0, 10)
  const re = rangeEndYmd.slice(0, 10)
  const start = new Date(`${rs}T00:00:00+09:00`)
  const endInclusive = new Date(`${re}T00:00:00+09:00`)
  const endExclusive = new Date(endInclusive.getTime() + 86400000)
  const label = `${toYmdCompact(rs)}~${toYmdCompact(re)}`
  return { label, start, end: endExclusive, rangeStart: rs, rangeEnd: re }
}
