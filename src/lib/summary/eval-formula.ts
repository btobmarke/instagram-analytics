/**
 * サマリーテンプレート用カスタム指標の評価（クライアント／サーバー共用）
 */

import type { FormulaNode, FormulaStep } from '@/lib/summary/formula-types'

export type { FormulaNode, FormulaStep } from '@/lib/summary/formula-types'

type FormulaNAryOperator = 'min' | 'max' | 'coalesce'

function isNAryOperator(op: FormulaStep['operator']): op is FormulaNAryOperator {
  return op === 'min' || op === 'max' || op === 'coalesce'
}

function roundResult(v: number): number {
  return Math.round(v * 100) / 100
}

function readMetric(
  rawData: Record<string, Record<string, number | null>>,
  id: string,
  label: string,
): number | null {
  const v = rawData[id]?.[label]
  return v !== null && v !== undefined ? v : null
}

function readOperand(
  rawData: Record<string, Record<string, number | null>>,
  timeHeaders: string[],
  label: string,
  operandId: string,
  operandIsConst: boolean | undefined,
  operandTimeOp: FormulaStep['operandTimeOp'] | undefined,
): number | null {
  if (operandIsConst) {
    const n = Number(operandId)
    return Number.isFinite(n) ? n : null
  }
  const v = readMetric(rawData, operandId, label)
  const op = operandTimeOp ?? 'none'
  if (op === 'none') return v
  const idx = timeHeaders.indexOf(label)
  if (idx <= 0) return null
  const prevLabel = timeHeaders[idx - 1]!
  const prev = readMetric(rawData, operandId, prevLabel)
  if (op === 'lag1') return prev
  if (op === 'diff_prev') {
    if (v === null || prev === null) return null
    return v - prev
  }
  return v
}

function readBase(
  rawData: Record<string, Record<string, number | null>>,
  timeHeaders: string[],
  label: string,
  formula: FormulaNode,
): number | null {
  if (formula.baseOperandIsConst) {
    const n = Number(formula.baseOperandId)
    return Number.isFinite(n) ? n : null
  }
  const v = readMetric(rawData, formula.baseOperandId, label)
  const op = formula.baseTimeOp ?? 'none'
  if (op === 'none') return v
  const idx = timeHeaders.indexOf(label)
  if (idx <= 0) return null
  const prevLabel = timeHeaders[idx - 1]!
  const prev = readMetric(rawData, formula.baseOperandId, prevLabel)
  if (op === 'lag1') return prev
  if (op === 'diff_prev') {
    if (v === null || prev === null) return null
    return v - prev
  }
  return v
}

function evalNAry(
  fn: FormulaNAryOperator,
  args: (number | null)[],
): number | null {
  const nums = args.filter((x): x is number => x !== null && x !== undefined)
  if (fn === 'coalesce') {
    for (const a of args) {
      if (a !== null && a !== undefined) return a
    }
    return null
  }
  if (nums.length === 0) return null
  if (fn === 'min') return Math.min(...nums)
  return Math.max(...nums)
}

/**
 * フォーミュラを 1 期間ラベルについて評価する。
 * + / − は欠損（null）を 0 として足し引き（既存 UI と同じ）。
 * 例外: 左端の列で「− 左の列（lag1）」かつ左列がないためオペランドが null のときは
 * 自列 − 0 とせず null（差・前期比のセマンティクスに合わせる）。
 * × / ÷ / min / max / coalesce は厳密な null 伝播（coalesce は先頭の非 null）
 */
export function evalSummaryFormula(
  formula: FormulaNode,
  rawData: Record<string, Record<string, number | null>>,
  label: string,
  timeHeaders: string[],
): number | null {
  let sawNumeric = false
  const asPlusMinus = (v: number | null) => (v === null ? 0 : v)

  let result: number | null = readBase(rawData, timeHeaders, label, formula)
  if (result !== null && result !== undefined) sawNumeric = true

  for (const step of formula.steps) {
    if (isNAryOperator(step.operator)) {
      const ids = [step.operandId, ...(step.extraOperandIds ?? [])].filter(Boolean)
      const constFlags = [
        Boolean(step.operandIsConst),
        ...((step.extraOperandsAreConst ?? []).map(Boolean)),
      ]
      const args = ids.map((id, j) =>
        readOperand(
          rawData,
          timeHeaders,
          label,
          id,
          constFlags[j],
          step.operandTimeOp,
        ),
      )
      if (args.some((a) => a !== null && a !== undefined)) sawNumeric = true
      if (result !== null && result !== undefined) sawNumeric = true

      const allArgs = [result, ...args]
      result = evalNAry(step.operator, allArgs)
      if (result !== null && result !== undefined) sawNumeric = true
      continue
    }

    const operand = readOperand(
      rawData,
      timeHeaders,
      label,
      step.operandId,
      step.operandIsConst,
      step.operandTimeOp,
    )
    if (operand !== null && operand !== undefined) sawNumeric = true
    if (result !== null && result !== undefined) sawNumeric = true

    switch (step.operator) {
      case '+':
        result = asPlusMinus(result) + asPlusMinus(operand)
        break
      case '-': {
        const colIdx = timeHeaders.indexOf(label)
        const lag1MissingAtLeftEdge =
          colIdx <= 0 &&
          (step.operandTimeOp ?? 'none') === 'lag1' &&
          operand === null
        if (lag1MissingAtLeftEdge) return null
        result = asPlusMinus(result) - asPlusMinus(operand)
        break
      }
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
    }
  }

  if (!sawNumeric) return null
  const rounded = roundResult(result ?? 0)
  const tm = formula.thresholdMode ?? 'none'
  const tv = formula.thresholdValue
  if (tm === 'gte' && tv != null && rounded < tv) return null
  if (tm === 'lte' && tv != null && rounded > tv) return null
  return rounded
}

/** データ取得に必要なメトリクス fieldRef を列挙（定数オペランドは除く） */
export function collectFormulaMetricRefs(formula: FormulaNode | undefined): string[] {
  if (!formula) return []
  const out: string[] = []
  if (!formula.baseOperandIsConst && formula.baseOperandId) {
    out.push(formula.baseOperandId)
  }
  for (const step of formula.steps) {
    if (isNAryOperator(step.operator)) {
      const ids = [step.operandId, ...(step.extraOperandIds ?? [])].filter(Boolean)
      const constFlags = [
        Boolean(step.operandIsConst),
        ...((step.extraOperandsAreConst ?? []).map(Boolean)),
      ]
      for (let i = 0; i < ids.length; i++) {
        if (!constFlags[i] && ids[i]) out.push(ids[i]!)
      }
      continue
    }
    if (!step.operandIsConst && step.operandId) out.push(step.operandId)
  }
  return out
}
