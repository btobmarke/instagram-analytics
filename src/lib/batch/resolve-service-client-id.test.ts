import { describe, expect, it } from 'vitest'
import { resolveClientIdFromServiceJoin } from '@/lib/batch/resolve-service-client-id'

describe('resolveClientIdFromServiceJoin', () => {
  it('projects がオブジェクトのとき', () => {
    expect(resolveClientIdFromServiceJoin({ projects: { client_id: 'c1' } })).toBe('c1')
  })
  it('projects が配列のとき（先頭の client_id）', () => {
    expect(resolveClientIdFromServiceJoin({ projects: [{ client_id: 'c2' }] })).toBe('c2')
  })
  it('空配列や欠損は null', () => {
    expect(resolveClientIdFromServiceJoin({ projects: [] })).toBe(null)
    expect(resolveClientIdFromServiceJoin(null)).toBe(null)
    expect(resolveClientIdFromServiceJoin({})).toBe(null)
  })
})
