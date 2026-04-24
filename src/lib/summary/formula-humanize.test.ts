import { describe, it, expect } from 'vitest'
import type { FormulaNode } from '@/lib/summary/formula-types'
import { buildFormulaPlainLanguageSummary } from '@/lib/summary/formula-humanize'
import { encodeLineShopcardCumulativeUsersRef } from '@/lib/summary/line-shopcard-cumulative-users-ref'

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

  it('describes LINE cumulative slice', () => {
    const L2 = (id: string) =>
      id === 'line_oam_shopcard_point.point'
        ? 'ポイント値'
        : id === 'line_oam_shopcard_point.users'
          ? 'ユーザー数'
          : id
    const f: FormulaNode = {
      baseOperandId: 'line_oam_shopcard_point.point',
      steps: [{ operator: '+', operandId: '0', operandIsConst: true }],
      cumulativeUsersSliceRef: encodeLineShopcardCumulativeUsersRef('eq', 3),
    }
    const s = buildFormulaPlainLanguageSummary(f, L2)
    expect(s).toContain('ポイント値')
    expect(s).toContain('ちょうど')
    expect(s).toContain('3')
  })
})
