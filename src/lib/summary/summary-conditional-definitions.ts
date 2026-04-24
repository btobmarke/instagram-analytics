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
import {
  LINE_REWARDCARD_COND_AGG_TABLE_SPEC,
  isLineRewardcardCondAggTableName,
} from '@/lib/summary/line-rewardcard-conditional-allowlist'

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

/** LINE ショップカード「ポイント分布」: 対象日スナップショットで条件行の数値列を合算（旧保存・互換） */
export const DEF_LINE_OAM_SHOPCARD_POINT_COND_SUM = 'line_oam_shopcard_point_cond_sum' as const

/**
 * LINE リワードカード系テーブル（ホワイトリスト）の条件付き集計。
 * UI から `table` / `compareField` / `aggregate` / `sumField` を選ぶ（B レベル）。
 */
export const DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG = 'line_oam_rewardcard_table_cond_agg' as const

const CompareOpSchema = z.enum(['eq', 'gte', 'lte', 'gt', 'lt'])

export const LineRewardcardTableCondAggParamsSchema = z
  .object({
    table: z.enum(['line_oam_shopcard_point', 'line_oam_shopcard_status']),
    compareField: z.string().min(1).max(80),
    compareOp: CompareOpSchema,
    compareValue: z.number(),
    aggregate: z.enum(['sum', 'row_count']),
    sumField: z.string().min(1).max(80).optional(),
  })
  .superRefine((data, ctx) => {
    if (!isLineRewardcardCondAggTableName(data.table)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid table' })
      return
    }
    const spec = LINE_REWARDCARD_COND_AGG_TABLE_SPEC[data.table]
    if (!spec.numericFields.includes(data.compareField)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['compareField'], message: 'not allowed for table' })
    }
    if (data.aggregate === 'sum') {
      if (!data.sumField) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sumField'], message: 'required for sum' })
        return
      }
      if (!spec.numericFields.includes(data.sumField)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sumField'], message: 'not allowed for table' })
      }
      if (data.sumField === data.compareField) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sumField'],
          message: 'compareField と同じ列は選べません（別の数値列を選んでください）',
        })
      }
    }
  })

export type LineRewardcardTableCondAggParams = z.infer<typeof LineRewardcardTableCondAggParamsSchema>

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

function numericCompare(rowVal: number, op: CumulativeUsersCompareOp, threshold: number): boolean {
  switch (op) {
    case 'eq':
      return rowVal === threshold
    case 'gte':
      return rowVal >= threshold
    case 'lte':
      return rowVal <= threshold
    case 'gt':
      return rowVal > threshold
    case 'lt':
      return rowVal < threshold
    default:
      return false
  }
}

async function fetchLineOamRewardcardTableCondAggRows(
  supabase: SummaryConditionalSupabase,
  serviceId: string,
  table: LineRewardcardTableCondAggParams['table'],
  selectFields: Set<string>,
  periods: SummaryConditionalPeriod[],
): Promise<Array<Record<string, unknown>>> {
  const { data: rcRows } = await supabase
    .from('line_oam_rewardcards')
    .select('id')
    .eq('service_id', serviceId)
  if (!rcRows || rcRows.length === 0) return []

  const rewardcardIds = rcRows.map((r) => r.id)
  const minKey = periods.map(periodAsOfDateKeyJst).sort()[0]!
  const maxKey = periods.map(periodAsOfDateKeyJst).sort().slice(-1)[0]!

  const cols = ['date', ...selectFields]
  const selectCols = [...new Set(cols)].join(',')

  const { data: rawRows } = await supabase
    .from(table)
    .select(selectCols)
    .in('line_rewardcard_id', rewardcardIds)
    .gte('date', minKey)
    .lte('date', maxKey)

  return (rawRows ?? []) as Array<Record<string, unknown>>
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

  [DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG]: async (supabase, serviceId, instances, periods) => {
    const parsedList: Array<{ ref: string; p: LineRewardcardTableCondAggParams }> = []
    for (const { ref, params } of instances) {
      const pr = LineRewardcardTableCondAggParamsSchema.safeParse(params)
      if (!pr.success) continue
      parsedList.push({ ref, p: pr.data })
    }
    if (parsedList.length === 0) return {}

    const byTable = new Map<LineRewardcardTableCondAggParams['table'], Set<string>>()
    for (const { p } of parsedList) {
      let s = byTable.get(p.table)
      if (!s) {
        s = new Set<string>()
        byTable.set(p.table, s)
      }
      s.add(p.compareField)
      if (p.aggregate === 'sum' && p.sumField) s.add(p.sumField)
    }

    const rowsCache = new Map<LineRewardcardTableCondAggParams['table'], Array<Record<string, unknown>>>()
    for (const [tbl, fields] of byTable) {
      const rows = await fetchLineOamRewardcardTableCondAggRows(
        supabase,
        serviceId,
        tbl,
        fields,
        periods,
      )
      rowsCache.set(tbl, rows)
    }

    const out: Record<string, Record<string, number | null>> = {}
    for (const { ref, p } of parsedList) {
      const rows = rowsCache.get(p.table) ?? []
      const byLabel: Record<string, number | null> = {}
      for (const period of periods) {
        const asOf = periodAsOfDateKeyJst(period)
        let sum = 0
        let count = 0
        let any = false
        for (const row of rows) {
          const d = row.date as string | undefined
          if (d !== asOf) continue
          const cv = row[p.compareField]
          if (typeof cv !== 'number' || !Number.isFinite(cv)) continue
          if (!numericCompare(cv, p.compareOp as CumulativeUsersCompareOp, p.compareValue)) continue
          if (p.aggregate === 'row_count') {
            count += 1
            any = true
          } else {
            const sv = p.sumField ? row[p.sumField] : null
            if (typeof sv === 'number' && Number.isFinite(sv)) {
              sum += sv
              any = true
            }
          }
        }
        byLabel[period.label] = any ? (p.aggregate === 'row_count' ? count : sum) : null
      }
      out[ref] = byLabel
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
  if (definitionId === DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG) {
    const p = LineRewardcardTableCondAggParamsSchema.safeParse(params)
    if (!p.success) return null
    const cmpId = `${p.data.table}.${p.data.compareField}`
    const opJa =
      p.data.compareOp === 'eq' ? 'ちょうど'
        : p.data.compareOp === 'gte' ? '以上'
          : p.data.compareOp === 'lte' ? '以下'
            : p.data.compareOp === 'gt' ? 'より大きい'
              : '未満'
    if (p.data.aggregate === 'row_count') {
      return `各列の対象日のスナップショットで、${findLabel(cmpId)} が ${opJa} ${p.data.compareValue} の行をリワードカード横断で数えます。`
    }
    const sumId = `${p.data.table}.${p.data.sumField!}`
    return `各列の対象日のスナップショットで、${findLabel(cmpId)} が ${opJa} ${p.data.compareValue} の行について ${findLabel(sumId)} をリワードカード横断で合算します。`
  }
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
  if (definitionId === DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG) {
    const p = LineRewardcardTableCondAggParamsSchema.safeParse(params)
    if (!p.success) return null
    const sym =
      p.data.compareOp === 'eq' ? '='
        : p.data.compareOp === 'gte' ? '≥'
          : p.data.compareOp === 'lte' ? '≤'
            : p.data.compareOp === 'gt' ? '>'
              : '<'
    const agg = p.data.aggregate === 'row_count' ? '行数' : `${p.data.sumField} 合算`
    return `条件付き: ${p.data.table}.${p.data.compareField} ${sym} ${p.data.compareValue}（${agg}）`
  }
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
