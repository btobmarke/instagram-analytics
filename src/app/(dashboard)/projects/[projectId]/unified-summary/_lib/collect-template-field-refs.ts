import type { UnifiedTableRow } from './types'
import type { FormulaNode } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { collectFormulaOperandRefs } from '@/lib/summary/eval-service-formula'

/** 横断テンプレで「生の table.field」として fetch 可能な ref か（カスタム指標 UUID は false） */
export function isUnifiedSummaryScalarMetricRef(ref: string): boolean {
  if (!ref || !ref.includes('.')) return false
  if (ref.startsWith('custom.')) return false
  return true
}

/**
 * 横断テンプレの行から、各サービスで fetchMetricsByRefs に渡す fieldRef 一覧を構築する。
 * カスタム指標行は式のオペランド（生指標）を展開する。
 */
export function collectUnifiedTemplateFieldRefs(
  rows: UnifiedTableRow[],
  customFormulasByService: Map<string, Map<string, FormulaNode>>,
): { serviceId: string; fieldRefs: string[] }[] {
  const bySvc = new Map<string, Set<string>>()
  for (const row of rows) {
    const formula = customFormulasByService.get(row.serviceId)?.get(row.metricRef)
    if (formula) {
      for (const id of collectFormulaOperandRefs(formula)) {
        if (isUnifiedSummaryScalarMetricRef(id)) {
          let s = bySvc.get(row.serviceId)
          if (!s) {
            s = new Set()
            bySvc.set(row.serviceId, s)
          }
          s.add(id)
        }
      }
    } else if (isUnifiedSummaryScalarMetricRef(row.metricRef)) {
      let s = bySvc.get(row.serviceId)
      if (!s) {
        s = new Set()
        bySvc.set(row.serviceId, s)
      }
      s.add(row.metricRef)
    }
  }
  return [...bySvc.entries()]
    .filter(([, set]) => set.size > 0)
    .map(([serviceId, set]) => ({ serviceId, fieldRefs: [...set] }))
}
