import type { FormulaNode, FormulaStep, FormulaOperandTimeOp } from '@/lib/summary/formula-types'
import { NARY_OPERATOR_LABELS, OPERATOR_SYMBOLS } from '@/lib/summary/formula-types'

function isNAry(op: FormulaStep['operator']): boolean {
  return op === 'min' || op === 'max' || op === 'coalesce'
}

function metricTitle(id: string, isConst: boolean, findLabel: (id: string) => string): string {
  if (isConst) return `定数 ${id}`
  return `「${findLabel(id)}」`
}

/** 指標＋時間変換を、サマリの1セル単位の日本語で説明 */
function operandReading(
  id: string,
  isConst: boolean,
  timeOp: FormulaOperandTimeOp | undefined,
  findLabel: (id: string) => string,
): string {
  if (isConst) return `定数 ${id}`
  const title = metricTitle(id, false, findLabel)
  const t = timeOp ?? 'none'
  if (t === 'none') return `${title}の、この列の数値`
  if (t === 'lag1') {
    return `${title}の一つ前の期間の数値（日次では暦の前日・JST。データが無いときは —）`
  }
  return `${title}の差（この列 − 一つ前の期間。日次では暦の前日・JST。データが無いときは —）`
}

function describeStep(step: FormulaStep, findLabel: (id: string) => string): string {
  if (isNAry(step.operator)) {
    const ids = [step.operandId, ...(step.extraOperandIds ?? [])]
    const flags = [Boolean(step.operandIsConst), ...((step.extraOperandsAreConst ?? []).map(Boolean))]
    const args = ids.map((id, j) => operandReading(id, flags[j] ?? false, step.operandTimeOp, findLabel))
    return `${NARY_OPERATOR_LABELS[step.operator]}（${args.join('，')}）`
  }
  const sym = OPERATOR_SYMBOLS[step.operator as keyof typeof OPERATOR_SYMBOLS]
  const right = operandReading(
    step.operandId,
    Boolean(step.operandIsConst),
    step.operandTimeOp,
    findLabel,
  )
  return `${sym} ${right}`
}

/**
 * サマリ表の「1マス」をどう計算するか、ユーザー向けの短文（モーダル用）
 */
export function buildFormulaPlainLanguageSummary(
  formula: FormulaNode,
  findLabel: (id: string) => string,
): string {
  const base = formula.baseOperandIsConst
    ? `定数 ${formula.baseOperandId} を起点にします。`
    : (() => {
        const t = formula.baseTimeOp ?? 'none'
        const title = metricTitle(formula.baseOperandId, false, findLabel)
        if (t === 'none') return `${title}の、この列の数値を起点にします。`
        if (t === 'lag1') {
          return `${title}の一つ前の期間の数値を起点にします（日次は暦の前日・JST。データが無いときは —）。`
        }
        return `${title}について（この列 − 一つ前の期間）を起点にします（日次は暦の前日・JST。データが無いときは —）。`
      })()

  if (!formula.steps.length) return `各セルでは、${base}`

  const parts = formula.steps.map((s) => describeStep(s, findLabel))
  return `各セルでは、${base} そのあと ${parts.join(' → ')}。`
}
