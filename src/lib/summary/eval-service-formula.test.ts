import { describe, expect, it } from 'vitest'
import type { FormulaNode } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { collectFormulaOperandRefs, evalServiceSummaryFormula } from './eval-service-formula'

describe('evalServiceSummaryFormula', () => {
  const raw: Record<string, Record<string, number | null>> = {
    't.a': { '1/1': 10, '1/2': 20 },
    't.b': { '1/1': 2, '1/2': null },
  }

  it('adds with null as zero', () => {
    const f: FormulaNode = {
      baseOperandId: 't.a',
      steps: [{ operator: '+', operandId: 't.b' }],
    }
    expect(evalServiceSummaryFormula(f, raw, '1/1')).toBe(12)
  })

  it('multiplies null to null', () => {
    const f: FormulaNode = {
      baseOperandId: 't.a',
      steps: [{ operator: '*', operandId: 't.b' }],
    }
    expect(evalServiceSummaryFormula(f, raw, '1/2')).toBe(null)
  })

  it('threshold gte hides small values', () => {
    const f: FormulaNode = {
      baseOperandId: 't.a',
      steps: [],
      thresholdMode: 'gte',
      thresholdValue: 15,
    }
    expect(evalServiceSummaryFormula(f, raw, '1/1')).toBe(null)
    expect(evalServiceSummaryFormula(f, raw, '1/2')).toBe(20)
  })
})

describe('collectFormulaOperandRefs', () => {
  it('collects base and step operand ids', () => {
    const f: FormulaNode = {
      baseOperandId: 'x.1',
      steps: [
        { operator: '+', operandId: 'y.2' },
        { operator: '/', operandId: 'z.3' },
      ],
    }
    expect(collectFormulaOperandRefs(f).sort()).toEqual(['x.1', 'y.2', 'z.3'])
  })
})
