import { describe, expect, it } from 'vitest'
import { canDeleteClient } from './can-delete-client'

describe('canDeleteClient', () => {
  it('プロジェクトが無いときのみ削除可', () => {
    expect(canDeleteClient(0)).toBe(true)
    expect(canDeleteClient(1)).toBe(false)
    expect(canDeleteClient(3)).toBe(false)
  })
})
