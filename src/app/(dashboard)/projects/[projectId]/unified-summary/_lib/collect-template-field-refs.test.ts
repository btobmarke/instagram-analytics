import { describe, expect, it } from 'vitest'
import type { UnifiedTableRow } from './types'
import type { FormulaNode } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { collectUnifiedTemplateFieldRefs } from './collect-template-field-refs'

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

  it('expands LINE cumulative slice custom metric ref', () => {
    const rows: UnifiedTableRow[] = [
      { id: '1', serviceId: 's1', serviceType: 'line', metricRef: 'uuid-cm-pt3', label: '3pt' },
    ]
    const formula: FormulaNode = {
      baseOperandId: 'line_oam_shopcard_point.point',
      steps: [{ operator: '+', operandId: '0', operandIsConst: true }],
      cumulativeUsersSliceRef: 'line_oam_shopcard_point.cumulative_users@eq:3',
    }
    const formulas = new Map([['s1', new Map([['uuid-cm-pt3', formula]])]])
    const out = collectUnifiedTemplateFieldRefs(rows, formulas)
    expect(out).toEqual([
      { serviceId: 's1', fieldRefs: ['line_oam_shopcard_point.cumulative_users@eq:3'] },
    ])
  })
})
