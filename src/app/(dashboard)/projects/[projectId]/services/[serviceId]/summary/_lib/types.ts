// ── 共有型定義 ──────────────────────────────────────────────────

import type { FormulaNode, FormulaBinaryOperator, FormulaNAryOperator } from '@/lib/summary/formula-types'
import {
  OPERATOR_SYMBOLS,
  NARY_OPERATOR_LABELS,
  TIME_OP_LABELS,
} from '@/lib/summary/formula-types'
import { parseLineShopcardCumulativeUsersRef } from '@/lib/summary/line-shopcard-cumulative-users-ref'

export type {
  FormulaNode,
  FormulaStep,
  FormulaBinaryOperator,
  FormulaNAryOperator,
  FormulaOperandTimeOp,
  FormulaThresholdMode,
} from '@/lib/summary/formula-types'

export { OPERATOR_SYMBOLS, NARY_OPERATOR_LABELS, TIME_OP_LABELS } from '@/lib/summary/formula-types'

/** 後方互換: 四則のみの演算子 */
export type FormulaOperator = import('@/lib/summary/formula-types').FormulaBinaryOperator

export interface ServiceDetail {
  id: string
  service_name: string
  service_type: string
  project: { id: string; project_name: string }
  /** API が返す場合（Instagram の連携アカウント ID など） */
  type_config?: { ig_account_ref_id?: string } | null
}

/** カード（指標候補） */
export interface MetricCard {
  id: string           // "テーブル名.フィールド名" 形式
  label: string        // 日本語表示名
  category: string     // カテゴリ（テーブル単位）
  fieldRef: string     // DB生フィールド名
  description?: string // 指標の説明文
  formula?: FormulaNode
}

function operandDisplay(
  id: string,
  findLabel: (id: string) => string,
  mode: 'label' | 'id',
  isConst?: boolean,
  timeOp?: import('@/lib/summary/formula-types').FormulaOperandTimeOp,
): string {
  const core = isConst ? id : mode === 'label' ? findLabel(id) : id
  const t = timeOp && timeOp !== 'none' ? ` [${TIME_OP_LABELS[timeOp]}]` : ''
  return isConst ? `定数 ${core}` : `${core}${t}`
}

const CUMULATIVE_OP_SYMBOL: Record<string, string> = {
  eq: '=',
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
}

/** 式を人間可読な文字列に変換 */
export function formatFormula(
  formula: FormulaNode,
  findLabel: (id: string) => string,
  mode: 'label' | 'id' = 'label',
): string {
  if (formula.cumulativeUsersSliceRef) {
    const p = parseLineShopcardCumulativeUsersRef(formula.cumulativeUsersSliceRef)
    if (p) {
      const sym = CUMULATIVE_OP_SYMBOL[p.op] ?? p.op
      return `ポイント分布: point ${sym} ${p.threshold}（users 合計・対象日のスナップショット）`
    }
  }
  const baseStr = operandDisplay(formula.baseOperandId, findLabel, mode, formula.baseOperandIsConst, formula.baseTimeOp)
  const parts: string[] = [baseStr]
  let needsGroup = false
  for (let i = 0; i < formula.steps.length; i++) {
    const s = formula.steps[i]
    const isNary = s.operator === 'min' || s.operator === 'max' || s.operator === 'coalesce'
    if (!isNary && (s.operator === '*' || s.operator === '/') && !needsGroup) {
      const prevOps = formula.steps.slice(0, i).map(p => p.operator)
      if (prevOps.some(o => o === '+' || o === '-')) {
        parts.unshift('(')
        parts.push(')')
        needsGroup = true
      }
    }
    if (isNary) {
      const labelN = NARY_OPERATOR_LABELS[s.operator as FormulaNAryOperator]
      const ids = [s.operandId, ...(s.extraOperandIds ?? [])]
      const constFlags = [
        Boolean(s.operandIsConst),
        ...((s.extraOperandsAreConst ?? []).map(Boolean)),
      ]
      const sub = ids
        .map((id, j) => operandDisplay(id, findLabel, mode, constFlags[j], s.operandTimeOp))
        .join(', ')
      parts.push(` ${labelN}(${sub})`)
      continue
    }
    parts.push(` ${OPERATOR_SYMBOLS[s.operator as FormulaBinaryOperator]} `)
    parts.push(operandDisplay(s.operandId, findLabel, mode, s.operandIsConst, s.operandTimeOp))
  }
  let out = parts.join('')
  const tm = formula.thresholdMode ?? 'none'
  if (tm === 'gte' && formula.thresholdValue != null) {
    out += ` （閾値以上: ${formula.thresholdValue}）`
  } else if (tm === 'lte' && formula.thresholdValue != null) {
    out += ` （閾値以下: ${formula.thresholdValue}）`
  }
  return out
}

/** テーブルの行 */
export interface TableRow {
  id: string
  label: string
  cells: Record<string, string>
  rowKind?: 'scalar' | 'breakdown'
  breakdown?: SummaryBreakdownConfig
}

export type TimeUnit = 'hour' | 'day' | 'week' | 'month' | 'custom_range'

export const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  hour: '1 時間',
  day:  '1 日',
  week: '1 週間',
  month:'1 ヶ月',
  custom_range: '期間指定（YYYYMMDD~YYYYMMDD）',
}

/** 友だち属性などの内訳行（サマリーテーブル専用） */
export interface BreakdownSliceSpec {
  /** 表示ラベル（例: 男性 20〜24歳） */
  label: string
  /** DB の gender 列と一致させる（例: male / female） */
  gender?: string | null
  /** DB の age 列と一致（部分一致不可。OAM CSV の表記に合わせる） */
  age?: string | null
}

/** Instagram アカウントインサイト（lifetime）の内訳スライス */
export interface IgAccountInsightBreakdownSlice {
  label: string
  /** ig_account_insight_fact.dimension_code（例: gender, country） */
  dimension_code: string
  /** ig_account_insight_fact.dimension_value（例: FEMALE, US） */
  dimension_value: string
}

/** 内訳行の設定（テンプレ保存・編集 UI 共用） */
export type SummaryBreakdownConfig =
  | {
      table: 'line_oam_friends_attr'
      valueField: 'percentage'
      slices: BreakdownSliceSpec[]
    }
  | {
      table: 'ig_account_insight_fact'
      /** 例: follower_demographics, engaged_audience_demographics */
      metricCode: string
      period: 'lifetime'
      valueField: 'value'
      slices: IgAccountInsightBreakdownSlice[]
    }

export interface StoredTemplateRow {
  id: string
  label: string
  formula?: FormulaNode
  /** 内訳行: 横軸セルに小さな表を表示（LINE 友だち属性など） */
  rowKind?: 'scalar' | 'breakdown'
  /** rowKind === breakdown のとき必須 */
  breakdown?: SummaryBreakdownConfig
}

export interface SummaryTemplate {
  id: string
  serviceId: string
  name: string
  timeUnit: TimeUnit
  /** timeUnit === custom_range のとき YYYY-MM-DD */
  rangeStart?: string | null
  rangeEnd?: string | null
  rows: StoredTemplateRow[]
  customCards: MetricCard[]
  createdAt: string
  updatedAt: string
}
