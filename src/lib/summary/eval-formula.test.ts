import { describe, it, expect } from 'vitest'
import type { FormulaNode } from '@/lib/summary/formula-types'
import { generateJstDayPeriodsFromRange } from '@/lib/summary/jst-periods'
import { evalSummaryFormula, collectFormulaMetricRefs } from '@/lib/summary/eval-formula'
import {
  DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
} from '@/lib/summary/summary-conditional-definitions'
import { encodeSummaryConditionalRef, parseSummaryConditionalRef } from '@/lib/summary/summary-conditional-ref'

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

  it('day mode: diff_prev uses calendar previous day, not table column order', () => {
    const periods = generateJstDayPeriodsFromRange('2026-04-01', '2026-04-03')
    const revHeaders = [...periods.map(p => p.label)].reverse()
    const labelToKey = new Map(periods.map(p => [p.label, p.dateKey]))
    const rawDay: Record<string, Record<string, number | null>> = {
      'm.a': {
        [periods[0]!.label]: 100,
        [periods[1]!.label]: 20,
        [periods[2]!.label]: 300,
      },
    }
    const f: FormulaNode = {
      baseOperandId: 'm.a',
      baseTimeOp: 'diff_prev',
      steps: [],
    }
    const mid = periods[1]!.label
    expect(evalSummaryFormula(f, rawDay, mid, revHeaders, labelToKey)).toBe(-80)
  })

  it('day mode: minus lag1 uses calendar previous day', () => {
    const periods = generateJstDayPeriodsFromRange('2026-04-01', '2026-04-03')
    const headersDay = periods.map(p => p.label)
    const labelToKey = new Map(periods.map(p => [p.label, p.dateKey]))
    const rawDay: Record<string, Record<string, number | null>> = {
      'm.a': {
        [periods[0]!.label]: 5,
        [periods[1]!.label]: 12,
        [periods[2]!.label]: 20,
      },
    }
    const f: FormulaNode = {
      baseOperandId: 'm.a',
      baseTimeOp: 'none',
      steps: [{ operator: '-', operandId: 'm.a', operandTimeOp: 'lag1' }],
    }
    expect(evalSummaryFormula(f, rawDay, periods[0]!.label, headersDay, labelToKey)).toBe(null)
    expect(evalSummaryFormula(f, rawDay, periods[1]!.label, headersDay, labelToKey)).toBe(7)
    expect(evalSummaryFormula(f, rawDay, periods[2]!.label, headersDay, labelToKey)).toBe(8)
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

  it('evalSummaryFormula reads conditional aggregate virtual ref', () => {
    const headers = ['4/22', '4/23']
    const vref = encodeSummaryConditionalRef({
      definitionId: DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
      table: 'line_oam_shopcard_point',
      compareField: 'point',
      compareOp: 'eq',
      compareValue: 3,
      aggregate: 'sum',
      sumField: 'users',
    })
    const raw: Record<string, Record<string, number | null>> = {
      [vref]: { '4/22': 10, '4/23': 12 },
    }
    const f: FormulaNode = {
      baseOperandId: 'line_oam_shopcard_point.point',
      steps: [{ operator: '+', operandId: '0', operandIsConst: true }],
      conditionalAggregate: {
        definitionId: DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
        params: {
          table: 'line_oam_shopcard_point',
          compareField: 'point',
          compareOp: 'eq',
          compareValue: 3,
          aggregate: 'sum',
          sumField: 'users',
        },
      },
    }
    expect(evalSummaryFormula(f, raw, '4/23', headers)).toBe(12)
  })

  it('collectFormulaMetricRefs for conditional aggregate', () => {
    const f: FormulaNode = {
      baseOperandId: 'line_oam_shopcard_point.point',
      steps: [{ operator: '+', operandId: '0', operandIsConst: true }],
      conditionalAggregate: {
        definitionId: DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
        params: {
          table: 'line_oam_shopcard_point',
          compareField: 'point',
          compareOp: 'eq',
          compareValue: 2,
          aggregate: 'sum',
          sumField: 'users',
        },
      },
    }
    expect(collectFormulaMetricRefs(f).length).toBe(1)
    expect(collectFormulaMetricRefs(f)[0]).toMatch(/^summary@cond:v1:/)
  })

  it('legacy cumulativeUsersSliceRef resolves to summary@cond ref for fetch', () => {
    const f: FormulaNode = {
      baseOperandId: 'line_oam_shopcard_point.point',
      steps: [{ operator: '+', operandId: '0', operandIsConst: true }],
      cumulativeUsersSliceRef: 'line_oam_shopcard_point.cumulative_users@lte:1',
    }
    const refs = collectFormulaMetricRefs(f)
    expect(refs).toHaveLength(1)
    expect(parseSummaryConditionalRef(refs[0]!)).toMatchObject({
      definitionId: DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
      params: expect.objectContaining({
        table: 'line_oam_shopcard_point',
        compareOp: 'lte',
        compareValue: 1,
      }),
    })
  })
})
