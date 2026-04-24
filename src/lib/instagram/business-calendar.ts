/**
 * Instagram バッチ・集計の「ビジネス日」（暦日）を Asia/Tokyo で揃える。
 * Vercel 等 UTC 実行でも、JST の「昨日」「7日分」と API の since/until を一致させる。
 */

import { addCalendarDaysFromYmd, getCalendarYmdInTimeZone, getYesterdayYmdRelativeToInstant } from '@/lib/google-ads/reporting-dates'

export const INSTAGRAM_BUSINESS_TIME_ZONE = 'Asia/Tokyo' as const

/** 指定瞬間のビジネス暦日 YYYY-MM-DD */
export function getInstagramBusinessTodayYmd(now: Date = new Date()): string {
  return getCalendarYmdInTimeZone(INSTAGRAM_BUSINESS_TIME_ZONE, now)
}

/** ビジネスタイムゾーンにおける「昨日」 */
export function getInstagramBusinessYesterdayYmd(now: Date = new Date()): string {
  return getYesterdayYmdRelativeToInstant(INSTAGRAM_BUSINESS_TIME_ZONE, now)
}

/**
 * since ～ until（YYYY-MM-DD、両端含む）を暦日で列挙。
 * タイムゾーンに依存しない純粋な文字列ステップ（addCalendarDaysFromYmd）。
 */
export function eachInstagramBusinessYmdInclusive(since: string, until: string): string[] {
  const s = since.slice(0, 10)
  const u = until.slice(0, 10)
  if (s > u) return []
  const out: string[] = []
  let cur = s
  while (cur <= u) {
    out.push(cur)
    cur = addCalendarDaysFromYmd(cur, 1)
  }
  return out
}

/**
 * period=day の時系列ポイント: API の end_time をビジネス暦日に直したうえで 1 日戻し、
 * total_value ループの value_date（= その日の since）と揃える。
 */
export function igAccountInsightValueDateFromEndTime(
  endTimeIso: string,
  timeZone: string = INSTAGRAM_BUSINESS_TIME_ZONE,
): string {
  const ms = Date.parse(endTimeIso)
  if (!Number.isFinite(ms)) return ''
  const ymd = getCalendarYmdInTimeZone(timeZone, new Date(ms))
  return addCalendarDaysFromYmd(ymd, -1)
}
