/**
 * 条件付き集計の定義レジストリ（テーブル横断・仮想 ref 用）
 * 新しい集計を足すときはここに definitionId と fetch を追加する。
 *
 * fetch-metrics とは循環参照にならないよう、Supabase クライアント型はここで宣言する。
 */

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDateKeyJst } from '@/lib/summary/jst-periods'
import { pointMatchesCumulativeSlice } from '@/lib/summary/line-shopcard-cumulative-users-ref'
import type { CumulativeUsersCompareOp } from '@/lib/summary/formula-types'

export type SummaryConditionalSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

/** fetch-metrics の Period と同形（構造的互換） */
export type SummaryConditionalPeriod = {
  label: string
  start: Date
  end: Date
  dateKey?: string
  rangeStart?: string
  rangeEnd?: string
}

/** LINE ショップカード「ポイント分布」: 対象日スナップショットで条件行の数値列を合算 */
export const DEF_LINE_OAM_SHOPCARD_POINT_COND_SUM = 'line_oam_shopcard_point_cond_sum' as const

export const LineShopcardPointSliceParamsSchema = z.object({
  compareField: z.literal('point'),
  compareOp: z.enum(['eq', 'gte', 'lte', 'gt', 'lt']),
  compareValue: z.number().int(),
  sumField: z.literal('users'),
})

export type LineShopcardPointSliceParams = z.infer<typeof LineShopcardPointSliceParamsSchema>

function periodAsOfDateKeyJst(period: SummaryConditionalPeriod): string {
  if (period.rangeEnd) return period.rangeEnd.slice(0, 10)
  if (period.dateKey) return period.dateKey
  return formatDateKeyJst(new Date(period.end.getTime() - 1))
}

async function fetchLineOamShopcardPointCondSum(
  supabase: SummaryConditionalSupabase,
  serviceId: string,
  paramList: LineShopcardPointSliceParams[],
  periods: SummaryConditionalPeriod[],
): Promise<Record<string, Record<string, number | null>>> {
  const result: Record<string, Record<string, number | null>> = {}
  if (paramList.length === 0) return result

  const { data: rcRows } = await supabase
    .from('line_oam_rewardcards')
    .select('id')
    .eq('service_id', serviceId)
  if (!rcRows || rcRows.length === 0) {
    return result
  }

  const rewardcardIds = rcRows.map((r) => r.id)
  const minKey = periods.map(periodAsOfDateKeyJst).sort()[0]!
  const maxKey = periods.map(periodAsOfDateKeyJst).sort().slice(-1)[0]!

  const { data: rawRows } = await supabase
    .from('line_oam_shopcard_point')
    .select('line_rewardcard_id, date, point, users')
    .in('line_rewardcard_id', rewardcardIds)
    .gte('date', minKey)
    .lte('date', maxKey)

  const rows = (rawRows ?? []) as Array<{
    line_rewardcard_id: string
    date: string
    point: number
    users: number | null
  }>

  for (const params of paramList) {
    const refKey = `${params.compareOp}:${params.compareValue}`
    result[refKey] = {}
    for (const p of periods) {
      const asOf = periodAsOfDateKeyJst(p)
      let sum = 0
      let any = false
      const op = params.compareOp as CumulativeUsersCompareOp
      for (const row of rows) {
        if (row.date !== asOf) continue
        if (!pointMatchesCumulativeSlice(row.point, op, params.compareValue)) continue
        const u = row.users
        if (u != null && Number.isFinite(u)) {
          sum += u
          any = true
        }
      }
      result[refKey][p.label] = any ? sum : null
    }
  }

  return result
}

type FetchOneDef = (
  supabase: SummaryConditionalSupabase,
  serviceId: string,
  instances: Array<{ ref: string; params: Record<string, unknown> }>,
  periods: SummaryConditionalPeriod[],
) => Promise<Record<string, Record<string, number | null>>>

const fetchers: Record<string, FetchOneDef> = {
  [DEF_LINE_OAM_SHOPCARD_POINT_COND_SUM]: async (supabase, serviceId, instances, periods) => {
    const refByKey = new Map<string, string>()
    const parsed: LineShopcardPointSliceParams[] = []
    for (const { ref, params } of instances) {
      const p = LineShopcardPointSliceParamsSchema.safeParse(params)
      if (!p.success) continue
      const key = `${p.data.compareOp}:${p.data.compareValue}`
      refByKey.set(key, ref)
      parsed.push(p.data)
    }
    if (parsed.length === 0) return {}

    const byOpVal = new Map<string, LineShopcardPointSliceParams>()
    for (const p of parsed) {
      byOpVal.set(`${p.compareOp}:${p.compareValue}`, p)
    }
    const uniqueParams = [...byOpVal.values()]

    const rawKeyed = await fetchLineOamShopcardPointCondSum(supabase, serviceId, uniqueParams, periods)
    const out: Record<string, Record<string, number | null>> = {}
    for (const [k, targetRef] of refByKey) {
      const src = rawKeyed[k]
      if (src) out[targetRef] = src
    }
    return out
  },
}

export async function fetchSummaryConditionalMetrics(
  supabase: SummaryConditionalSupabase,
  serviceId: string,
  instances: Array<{ definitionId: string; ref: string; params: Record<string, unknown> }>,
  periods: SummaryConditionalPeriod[],
): Promise<Record<string, Record<string, number | null>>> {
  const merged: Record<string, Record<string, number | null>> = {}
  const byDef = new Map<string, Array<{ ref: string; params: Record<string, unknown> }>>()
  for (const inst of instances) {
    let arr = byDef.get(inst.definitionId)
    if (!arr) {
      arr = []
      byDef.set(inst.definitionId, arr)
    }
    arr.push({ ref: inst.ref, params: inst.params })
  }

  for (const [definitionId, list] of byDef) {
    const fn = fetchers[definitionId]
    if (!fn) continue
    const part = await fn(supabase, serviceId, list, periods)
    Object.assign(merged, part)
  }
  return merged
}

export function humanizeConditionalAggregate(
  definitionId: string,
  params: Record<string, unknown>,
  findLabel: (id: string) => string,
): string | null {
  if (definitionId === DEF_LINE_OAM_SHOPCARD_POINT_COND_SUM) {
    const p = LineShopcardPointSliceParamsSchema.safeParse(params)
    if (!p.success) return null
    const pt = findLabel('line_oam_shopcard_point.point')
    const su = findLabel('line_oam_shopcard_point.users')
    const opJa =
      p.data.compareOp === 'eq' ? 'ちょうど'
        : p.data.compareOp === 'gte' ? '以上'
          : p.data.compareOp === 'lte' ? '以下'
            : p.data.compareOp === 'gt' ? 'より大きい'
              : '未満'
    return `各列の対象日のスナップショットで、${pt} が ${opJa} ${p.data.compareValue} の行について ${su} をリワードカード横断で合算します。`
  }
  return null
}

export function formatConditionalAggregateSummary(
  definitionId: string,
  params: Record<string, unknown>,
): string | null {
  if (definitionId === DEF_LINE_OAM_SHOPCARD_POINT_COND_SUM) {
    const p = LineShopcardPointSliceParamsSchema.safeParse(params)
    if (!p.success) return null
    const sym =
      p.data.compareOp === 'eq' ? '='
        : p.data.compareOp === 'gte' ? '≥'
          : p.data.compareOp === 'lte' ? '≤'
            : p.data.compareOp === 'gt' ? '>'
              : '<'
    return `条件付き集計: line_oam_shopcard_point.point ${sym} ${p.data.compareValue}（users 合算）`
  }
  return `条件付き集計: ${definitionId}`
}
