import { describe, expect, it } from 'vitest'
import type { UnifiedTableRow } from './types'
import type { FormulaNode } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { collectUnifiedTemplateFieldRefs } from './collect-template-field-refs'
import { DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG } from '@/lib/summary/summary-conditional-definitions'
import { encodeSummaryConditionalRef } from '@/lib/summary/summary-conditional-ref'

describe('collectUnifiedTemplateFieldRefs', () => {
  it('includes scalar row metricRefs', () => {
    const rows: UnifiedTableRow[] = [
      { id: '1', serviceId: 's1', serviceType: 'instagram', metricRef: 'ig_account_insight_fact.reach', label: 'R' },
    ]
    const formulas = new Map<string, Map<string, FormulaNode>>()
    const out = collectUnifiedTemplateFieldRefs(rows, formulas)
    expect(out).toEqual([{ serviceId: 's1', fieldRefs: ['ig_account_insight_fact.reach'] }])
  })

  it('expands custom formula operands', () => {
    const rows: UnifiedTableRow[] = [
      { id: '1', serviceId: 's1', serviceType: 'instagram', metricRef: 'uuid-cm-1', label: 'カスタム' },
    ]
    const formula: FormulaNode = {
      baseOperandId: 'ig_account_insight_fact.reach',
      steps: [{ operator: '/', operandId: 'ig_account_insight_fact.views' }],
    }
    const formulas = new Map([['s1', new Map([['uuid-cm-1', formula]])]])
    const out = collectUnifiedTemplateFieldRefs(rows, formulas)
    expect(out[0].fieldRefs.sort()).toEqual([
      'ig_account_insight_fact.reach',
      'ig_account_insight_fact.views',
    ])
  })

  it('expands LINE conditional aggregate custom metric ref', () => {
    const rows: UnifiedTableRow[] = [
      { id: '1', serviceId: 's1', serviceType: 'line', metricRef: 'uuid-cm-pt3', label: '3pt' },
    ]
    const formula: FormulaNode = {
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
    const formulas = new Map([['s1', new Map([['uuid-cm-pt3', formula]])]])
    const out = collectUnifiedTemplateFieldRefs(rows, formulas)
    const expectedRef = encodeSummaryConditionalRef({
      definitionId: DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
      table: 'line_oam_shopcard_point',
      compareField: 'point',
      compareOp: 'eq',
      compareValue: 3,
      aggregate: 'sum',
      sumField: 'users',
    })
    expect(out).toEqual([{ serviceId: 's1', fieldRefs: [expectedRef] }])
  })
})
