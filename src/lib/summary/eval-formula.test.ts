import { describe, it, expect } from 'vitest'
import type { FormulaNode } from '@/lib/summary/formula-types'
import { evalSummaryFormula, collectFormulaMetricRefs } from '@/lib/summary/eval-formula'

describe('evalSummaryFormula', () => {
  const headers = ['D1', 'D2', 'D3']
  const raw: Record<string, Record<string, number | null>> = {
    'm.a': { D1: 10, D2: 12, D3: 15 },
    'm.b': { D1: 100, D2: 100, D3: 100 },
  }

  it('computes diff_prev on base operand', () => {
    const f: FormulaNode = {
      baseOperandId: 'm.a',
      baseTimeOp: 'diff_prev',
      steps: [],
    }
    expect(evalSummaryFormula(f, raw, 'D1', headers)).toBe(null)
    expect(evalSummaryFormula(f, raw, 'D2', headers)).toBe(2)
    expect(evalSummaryFormula(f, raw, 'D3', headers)).toBe(3)
  })

  it('minus lag1 on first column is null (not same as current column)', () => {
    const f: FormulaNode = {
      baseOperandId: 'm.a',
      baseTimeOp: 'none',
      steps: [{ operator: '-', operandId: 'm.a', operandTimeOp: 'lag1' }],
    }
    expect(evalSummaryFormula(f, raw, 'D1', headers)).toBe(null)
    expect(evalSummaryFormula(f, raw, 'D2', headers)).toBe(2)
    expect(evalSummaryFormula(f, raw, 'D3', headers)).toBe(3)
  })

  it('divides by constant', () => {
    const f: FormulaNode = {
      baseOperandId: 'm.a',
      baseTimeOp: 'none',
      steps: [{ operator: '/', operandId: '100', operandIsConst: true }],
    }
    expect(evalSummaryFormula(f, raw, 'D2', headers)).toBe(0.12)
  })

  it('coalesce picks first non-null', () => {
    const raw2: Record<string, Record<string, number | null>> = {
      'm.x': { D1: null as number | null, D2: 5, D3: null },
      'm.y': { D1: 1, D2: null, D3: 2 },
    }
    const f: FormulaNode = {
      baseOperandId: 'm.x',
      steps: [{ operator: 'coalesce', operandId: 'm.y', extraOperandIds: [] }],
    }
    expect(evalSummaryFormula(f, raw2, 'D1', headers)).toBe(1)
    expect(evalSummaryFormula(f, raw2, 'D2', headers)).toBe(5)
  })

  it('collectFormulaMetricRefs skips constants', () => {
    const f: FormulaNode = {
      baseOperandId: '100',
      baseOperandIsConst: true,
      steps: [{ operator: '+', operandId: 'm.a', operandIsConst: false }],
    }
    expect(collectFormulaMetricRefs(f)).toEqual(['m.a'])
  })
})
