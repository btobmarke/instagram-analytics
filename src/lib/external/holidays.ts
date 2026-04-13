/**
 * 祝日判定ユーティリティ（日本）
 * date-holidays ライブラリを使用（APIコストゼロ）
 */

import Holidays from 'date-holidays'

const hd = new Holidays('JP')

export interface HolidayInfo {
  isHoliday: boolean
  name?: string
}

/**
 * 指定日が日本の祝日かどうかを判定する
 * @param date YYYY-MM-DD 形式の日付文字列
 */
export function getHolidayInfo(date: string): HolidayInfo {
  // JST の正午を基準にして判定（タイムゾーンずれを防ぐ）
  const d = new Date(`${date}T12:00:00+09:00`)
  const result = hd.isHoliday(d)
  if (!result || result === false) {
    return { isHoliday: false }
  }
  // result は HolidayObject | HolidayObject[] の可能性あり
  const arr = Array.isArray(result) ? result : [result]
  // public タイプを優先、なければ最初のエントリ
  const publicHoliday = arr.find((h) => h.type === 'public') ?? arr[0]
  return {
    isHoliday: true,
    name: publicHoliday?.name,
  }
}

/**
 * 日付範囲内の祝日情報をまとめて取得
 * @param startDate YYYY-MM-DD
 * @param endDate   YYYY-MM-DD（inclusive）
 */
export function getHolidaysInRange(
  startDate: string,
  endDate: string,
): Record<string, HolidayInfo> {
  const result: Record<string, HolidayInfo> = {}
  const start = new Date(`${startDate}T12:00:00+09:00`)
  const end   = new Date(`${endDate}T12:00:00+09:00`)

  let cur = new Date(start)
  while (cur <= end) {
    const ymd = cur.toISOString().slice(0, 10)
    result[ymd] = getHolidayInfo(ymd)
    cur = new Date(cur.getTime() + 86400000)
  }
  return result
}
