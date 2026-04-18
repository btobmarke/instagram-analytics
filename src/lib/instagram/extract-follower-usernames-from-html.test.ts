import { describe, it, expect } from 'vitest'
import { buildClassSelector, DEFAULT_IG_USERNAME_SPAN_CLASSES } from './extract-follower-usernames-from-html'

describe('buildClassSelector', () => {
  it('joins tokens with dot for compound class selector', () => {
    expect(buildClassSelector(DEFAULT_IG_USERNAME_SPAN_CLASSES)).toBe(
      '._ap3a._aaco._aacw._aacx._aad7._aade'
    )
  })

  it('trims and collapses whitespace', () => {
    expect(buildClassSelector('  foo  bar  ')).toBe('.foo.bar')
  })
})
