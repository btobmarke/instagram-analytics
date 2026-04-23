/**
 * Instagram Graph のインサイト値を DB 用数値に正規化する。
 * 成功レスポンス内では欠損・非数を 0 に寄せ、API 取得失敗時は呼び出し側で upsert しない。
 */

import { finiteNumberFromUnknown, finiteNumberOrZero } from '@/lib/batch/numeric-coerce'

const STORY_INSIGHT_BIGINT_MAX = 9223372036854775807
const STORY_INSIGHT_BIGINT_MIN = -9223372036854775808

type IgMediaInsightLike = {
  values?: Array<{ value?: unknown }>
  value?: unknown
  total_value?: { value?: unknown }
}

/** メディアインサイト 1 メトリクス行のスカラー値（解釈不能は 0） */
export function mediaInsightValueOrZero(insight: IgMediaInsightLike): number {
  const candidates = [insight.values?.[0]?.value, insight.value, insight.total_value?.value]
  for (const c of candidates) {
    const n = finiteNumberFromUnknown(c)
    if (n !== null) return n
  }
  return 0
}

/** navigation / profile_activity breakdown の value */
export function breakdownResultValueOrZero(rValue: unknown): number {
  return finiteNumberOrZero(rValue)
}

/**
 * アカウント時系列の `values[].value`。
 * スカラーのほか、API がオブジェクトで返すケースは数値葉の合算を試みる。
 */
export function accountTimeSeriesPointValueOrZero(v: unknown): number {
  const direct = finiteNumberFromUnknown(v)
  if (direct !== null) return direct
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    let sum = 0
    for (const x of Object.values(v as Record<string, unknown>)) {
      const n = finiteNumberFromUnknown(x)
      if (n !== null) sum += n
    }
    return Number.isFinite(sum) ? sum : 0
  }
  return 0
}

/** total_value.value（number 以外も文字列で取れたら数値化、だめなら 0） */
export function accountTotalValueScalarOrZero(val: unknown): number {
  return finiteNumberOrZero(val)
}

/** online_followers: 数値または時間帯オブジェクトの合計。全ゼロも 0 として保存 */
export function onlineFollowersScalarOrZero(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    let sum = 0
    for (const x of Object.values(val as Record<string, unknown>)) {
      if (typeof x === 'number' && Number.isFinite(x)) sum += x
    }
    return sum
  }
  return 0
}

/**
 * ig_story_insight_fact.value（BIGINT）。
 * 解釈不能は 0。BIGINT 範囲外のみ null（DB 破壊回避のため upsert 側で null を許容）。
 */
export function coerceStoryInsightBigintValue(v: unknown): number | null {
  const n = finiteNumberFromUnknown(v)
  const rounded = Math.round(n === null ? 0 : n)
  if (rounded > STORY_INSIGHT_BIGINT_MAX || rounded < STORY_INSIGHT_BIGINT_MIN) return null
  return rounded
}
