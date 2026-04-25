/**
 * サマリー・横断サマリーの「横軸期間」生成（API / クライアント共用）
 */

import { generateCustomRangePeriod, generateJstDayPeriods, generateJstDayPeriodsFromRange } from '@/lib/summary/jst-periods'

export type TimeUnit = 'hour' | 'day' | 'week' | 'month' | 'custom_range'

export interface Period {
  label: string
  start: Date
  end: Date
  /** 日次（JST）のとき DB の value_date と突き合わせる YYYY-MM-DD */
  dateKey?: string
  /** custom_range のとき含む日付境界 YYYY-MM-DD */
  rangeStart?: string
  rangeEnd?: string
}

/** 表示期間が長すぎるリクエストを防ぐ（日次で約13ヶ月相当） */
export const MAX_SUMMARY_PERIODS = 400

function generatePeriods(unit: TimeUnit, count: number): Period[] {
  const periods: Period[] = []
  const now = new Date()

  if (unit === 'day') {
    return generateJstDayPeriods(count, now)
  }

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    let start: Date, end: Date, label: string

    switch (unit) {
      case 'hour': {
        d.setHours(d.getHours() - i, 0, 0, 0)
        start = new Date(d)
        end = new Date(d); end.setHours(end.getHours() + 1)
        label = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`
        break
      }
      case 'week': {
        d.setDate(d.getDate() - i * 7)
        d.setHours(0, 0, 0, 0)
        start = new Date(d)
        end = new Date(d); end.setDate(end.getDate() + 7)
        label = `${d.getMonth() + 1}/${d.getDate()}週`
        break
      }
      case 'month': {
        d.setMonth(d.getMonth() - i)
        d.setDate(1); d.setHours(0, 0, 0, 0)
        start = new Date(d)
        end = new Date(d); end.setMonth(end.getMonth() + 1)
        label = `${d.getFullYear()}/${d.getMonth() + 1}`
        break
      }
      default: {
        start = new Date(d)
        end = new Date(d)
        label = ''
      }
    }
    periods.push({ label, start: start!, end: end! })
  }
  return periods
}

export function buildPeriods(
  unit: TimeUnit,
  count: number,
  rangeStartParam?: string | null,
  rangeEndParam?: string | null,
): Period[] | { error: string } {
  if (unit === 'custom_range') {
    if (!rangeStartParam || !rangeEndParam || rangeStartParam > rangeEndParam) {
      return { error: 'custom_range には rangeStart・rangeEnd（YYYY-MM-DD）が必要です' }
    }
    const cr = generateCustomRangePeriod(rangeStartParam, rangeEndParam)
    return [{ label: cr.label, start: cr.start, end: cr.end, rangeStart: cr.rangeStart, rangeEnd: cr.rangeEnd }]
  }

  if (rangeStartParam && rangeEndParam) {
    const rs = rangeStartParam.slice(0, 10)
    const re = rangeEndParam.slice(0, 10)
    if (rs > re) return { error: 'rangeStart は rangeEnd 以下である必要があります' }

    if (unit === 'day') {
      const periods = generateJstDayPeriodsFromRange(rs, re)
      if (periods.length > MAX_SUMMARY_PERIODS) {
        return { error: `表示期間の列数は最大 ${MAX_SUMMARY_PERIODS} までです（日次で約13ヶ月）` }
      }
      return periods
    }

    if (unit === 'week') {
      const periods: Period[] = []
      const startDate = new Date(`${rs}T12:00:00+09:00`)
      const endDate = new Date(`${re}T12:00:00+09:00`)

      const day = (startDate.getDay() + 6) % 7
      const monday = new Date(startDate)
      monday.setDate(monday.getDate() - day)
      monday.setHours(0, 0, 0, 0)

      let cur = monday
      while (cur <= endDate) {
        const start = new Date(cur)
        const end = new Date(cur); end.setDate(end.getDate() + 7)
        const label = `${start.getMonth() + 1}/${start.getDate()}週`
        periods.push({ label, start, end })
        cur = new Date(cur); cur.setDate(cur.getDate() + 7)
      }
      if (periods.length > MAX_SUMMARY_PERIODS) {
        return { error: `表示期間の列数は最大 ${MAX_SUMMARY_PERIODS} までです` }
      }
      return periods
    }

    if (unit === 'month') {
      const periods: Period[] = []
      const startDate = new Date(`${rs}T12:00:00+09:00`)
      const endDate = new Date(`${re}T12:00:00+09:00`)

      const cur = new Date(startDate)
      cur.setDate(1); cur.setHours(0, 0, 0, 0)

      while (cur <= endDate) {
        const start = new Date(cur)
        const end = new Date(cur); end.setMonth(end.getMonth() + 1)
        const label = `${start.getFullYear()}/${start.getMonth() + 1}`
        periods.push({ label, start, end })
        cur.setMonth(cur.getMonth() + 1)
      }
      if (periods.length > MAX_SUMMARY_PERIODS) {
        return { error: `表示期間の列数は最大 ${MAX_SUMMARY_PERIODS} までです` }
      }
      return periods
    }
  }

  return generatePeriods(unit, count)
}
