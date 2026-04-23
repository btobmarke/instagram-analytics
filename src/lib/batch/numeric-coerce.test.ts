import { describe, expect, it } from 'vitest'
import { csvCellNumberOrZero, finiteNumberFromUnknown, finiteNumberOrZero } from '@/lib/batch/numeric-coerce'

describe('numeric-coerce', () => {
  it('finiteNumberFromUnknown', () => {
    expect(finiteNumberFromUnknown(3)).toBe(3)
    expect(finiteNumberFromUnknown('1,234.5')).toBe(1234.5)
    expect(finiteNumberFromUnknown('')).toBe(null)
    expect(finiteNumberFromUnknown('  ')).toBe(null)
    expect(finiteNumberFromUnknown('x')).toBe(null)
    expect(finiteNumberFromUnknown(NaN)).toBe(null)
  })

  it('finiteNumberOrZero', () => {
    expect(finiteNumberOrZero(null)).toBe(0)
    expect(finiteNumberOrZero(undefined)).toBe(0)
    expect(finiteNumberOrZero('2')).toBe(2)
  })

  it('csvCellNumberOrZero', () => {
    expect(csvCellNumberOrZero('')).toBe(0)
    expect(csvCellNumberOrZero('0')).toBe(0)
    expect(csvCellNumberOrZero('  42  ')).toBe(42)
    expect(csvCellNumberOrZero(null)).toBe(0)
  })
})
