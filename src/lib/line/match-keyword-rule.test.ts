import { describe, expect, it } from 'vitest'
import { keywordMatchesRule } from './match-keyword-rule'

describe('keywordMatchesRule', () => {
  it('exact', () => {
    expect(keywordMatchesRule('hello', 'exact', 'hello')).toBe(true)
    expect(keywordMatchesRule('hello!', 'exact', 'hello')).toBe(false)
  })

  it('contains', () => {
    expect(keywordMatchesRule('say hello world', 'contains', 'hello')).toBe(true)
  })
})
