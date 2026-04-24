/**
 * カスタム指標 FormulaNode から「生データ取得用の仮想 ref」を解決する。
 */

import type { FormulaNode } from '@/lib/summary/formula-types'
import { parseLineShopcardCumulativeUsersRef } from '@/lib/summary/line-shopcard-cumulative-users-ref'
import { encodeSummaryConditionalRef } from '@/lib/summary/summary-conditional-ref'
import {
  DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
  DEF_LINE_OAM_SHOPCARD_POINT_COND_SUM,
} from '@/lib/summary/summary-conditional-definitions'

export function resolveSummaryFormulaDataRef(formula: FormulaNode): string | null {
  const ca = formula.conditionalAggregate
  if (ca?.definitionId) {
    if (ca.definitionId === DEF_LINE_OAM_SHOPCARD_POINT_COND_SUM) {
      const p = ca.params as {
        compareOp?: string
        compareValue?: number
      }
      if (p.compareOp && p.compareValue != null && Number.isFinite(p.compareValue)) {
        return encodeSummaryConditionalRef({
          definitionId: DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
          table: 'line_oam_shopcard_point',
          compareField: 'point',
          compareOp: p.compareOp,
          compareValue: p.compareValue,
          aggregate: 'sum',
          sumField: 'users',
        })
      }
    }
    return encodeSummaryConditionalRef({
      definitionId: ca.definitionId,
      ...ca.params,
    })
  }
  const leg = formula.cumulativeUsersSliceRef
  const parsed = leg ? parseLineShopcardCumulativeUsersRef(leg) : null
  if (parsed) {
    return encodeSummaryConditionalRef({
      definitionId: DEF_LINE_OAM_REWARDCARD_TABLE_COND_AGG,
      table: 'line_oam_shopcard_point',
      compareField: 'point',
      compareOp: parsed.op,
      compareValue: parsed.threshold,
      aggregate: 'sum',
      sumField: 'users',
    })
  }
  return null
}
