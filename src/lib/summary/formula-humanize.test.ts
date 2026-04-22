import { describe, it, expect } from 'vitest'
import type { FormulaNode } from '@/lib/summary/formula-types'
import { buildFormulaPlainLanguageSummary } from '@/lib/summary/formula-humanize'

describe('buildFormulaPlainLanguageSummary', () => {
  const L = (id: string) => (id === 'm.c' ? '友だち数' : id)

  it('describes diff_prev base', () => {
    const f: FormulaNode = {
      baseOperandId: 'm.c',
      baseTimeOp: 'diff_prev',
      steps: [],
    }
    const s = buildFormulaPlainLanguageSummary(f, L)
    expect(s).toContain('友だち数')
    expect(s).toContain('この列')
    expect(s).toContain('左となり')
  })

  it('describes const base with add', () => {
    const f: FormulaNode = {
      baseOperandId: '100',
      baseOperandIsConst: true,
      steps: [{ operator: '+', operandId: 'm.c', operandIsConst: false, operandTimeOp: 'none' }],
    }
    const s = buildFormulaPlainLanguageSummary(f, L)
    expect(s).toContain('定数 100')
    expect(s).toContain('友だち数')
  })
})
