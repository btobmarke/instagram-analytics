import { describe, expect, it } from 'vitest'
import { normalizeExplicitUserIds } from './process-broadcast-job-chunk'

describe('normalizeExplicitUserIds', () => {
  it('trims and dedupes', () => {
    expect(normalizeExplicitUserIds([' a ', 'a', 'b'])).toEqual(['a', 'b'])
  })

  it('ignores non-strings', () => {
    expect(normalizeExplicitUserIds([1, 'x', null])).toEqual(['x'])
  })
})
