import { describe, expect, it } from 'vitest'
import { chunkArray } from './chunk-array'

describe('chunkArray', () => {
  it('splits into fixed-size chunks', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns empty for empty input', () => {
    expect(chunkArray([], 500)).toEqual([])
  })

  it('returns empty for non-positive size', () => {
    expect(chunkArray([1, 2], 0)).toEqual([])
  })
})
