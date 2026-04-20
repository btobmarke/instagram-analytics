import { describe, expect, it } from 'vitest'
import { SegmentDefinitionSchema } from './segment-definition'

describe('SegmentDefinitionSchema', () => {
  it('parses minimal', () => {
    const r = SegmentDefinitionSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.follow_status).toBe('followed_only')
  })

  it('rejects unknown keys', () => {
    const r = SegmentDefinitionSchema.safeParse({ foo: 1 })
    expect(r.success).toBe(false)
  })
})
