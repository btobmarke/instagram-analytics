import { describe, expect, it } from 'vitest'

/**
 * fetchPerformance 内の「同一日・同一列の複数系列」マージは max とする。
 * ロジックのミニ再現（本番と同じ式）。
 */
function mergePoint(
  prev: number | null | undefined,
  next: number | null,
): number | null {
  if (prev == null || prev === undefined) return next
  if (next == null) return prev
  return Math.max(prev, next)
}

describe('GBP daily metric merge (max)', () => {
  it('keeps 40 when a later series is 0', () => {
    let v: number | null = null
    v = mergePoint(v, 40)
    v = mergePoint(v, 0)
    expect(v).toBe(40)
  })

  it('takes max when both non-null', () => {
    let v: number | null = null
    v = mergePoint(v, 10)
    v = mergePoint(v, 50)
    expect(v).toBe(50)
  })
})
