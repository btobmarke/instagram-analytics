/**
 * サービス詳細サマリー／横断サマリー共通のカスタム指標評価（現行の FormulaNode 形式）。
 * 拡張式（lag1 等）を型に載せたらここを拡張する。
 */

import type { FormulaNode } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { resolveSummaryFormulaDataRef } from '@/lib/summary/summary-formula-data-ref'

/** 式が参照する生指標 ID（カスタム指標 UUID は含めない） */
export function collectFormulaOperandRefs(formula: FormulaNode | undefined): string[] {
  if (!formula) return []
  const dr = resolveSummaryFormulaDataRef(formula)
  if (dr) return [dr]
  const out = new Set<string>()
  if (formula.baseOperandId) out.add(formula.baseOperandId)
  for (const s of formula.steps ?? []) {
    if (s.operandId) out.add(s.operandId)
  }
  return [...out]
}

/**
 * + / − は欠損（null）を 0 として足し引き
 * × / ÷ はいずれか欠損なら null
 * 閾値: 計算後の値が条件を満たさないとき null
 */
export function evalServiceSummaryFormula(
  formula: FormulaNode,
  rawData: Record<string, Record<string, number | null>>,
  label: string,
): number | null {
  const dataRef = resolveSummaryFormulaDataRef(formula)
  if (dataRef) {
    const v = rawData[dataRef]?.[label]
    return v !== null && v !== undefined ? Math.round(v as number) : null
  }

  let sawNumeric = false
  const get = (id: string): number | null => {
    const v = rawData[id]?.[label]
    if (v !== null && v !== undefined) sawNumeric = true
    return v ?? null
  }

  const asPlusMinus = (v: number | null) => (v === null ? 0 : v)

  let result: number | null = get(formula.baseOperandId)

  for (const step of formula.steps ?? []) {
    const operand = get(step.operandId)
    switch (step.operator) {
      case '+':
        result = asPlusMinus(result) + asPlusMinus(operand)
        break
      case '-':
        result = asPlusMinus(result) - asPlusMinus(operand)
        break
      case '*': {
        if (result === null || operand === null) return null
        result *= operand
        break
      }
      case '/': {
        if (result === null || operand === null) return null
        if (operand === 0) return null
        result /= operand
        break
      }
      default:
        return null
    }
  }

  if (!sawNumeric) return null
  const rounded = Math.round((result ?? 0) * 100) / 100
  const tm = formula.thresholdMode ?? 'none'
  const tv = formula.thresholdValue
  if (tm === 'gte' && tv != null && rounded < tv) return null
  if (tm === 'lte' && tv != null && rounded > tv) return null
  return rounded
}
