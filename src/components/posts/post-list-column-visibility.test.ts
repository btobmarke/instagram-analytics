import { describe, expect, it } from 'vitest'
import { isColumnVisible } from '@/components/posts/post-list-column-visibility'

describe('isColumnVisible', () => {
  it('列セットに無い ID は常に false', () => {
    const cols = [{ id: 'views', label: '表示' }]
    expect(isColumnVisible({ views: true, likes: true }, cols, 'likes')).toBe(false)
  })
  it('visible にキーが無いときは列の既定（リーチは既定オン）', () => {
    const cols = [{ id: 'reach', label: 'リーチ' }]
    expect(isColumnVisible({}, cols, 'reach')).toBe(true)
  })
  it('visible にキーが無いときオフ既定の列は false', () => {
    const cols = [{ id: 'shareRate', label: 'シェア率' }]
    expect(isColumnVisible({}, cols, 'shareRate')).toBe(false)
  })
  it('visible が true のとき true', () => {
    const cols = [{ id: 'reach', label: 'リーチ' }]
    expect(isColumnVisible({ reach: true }, cols, 'reach')).toBe(true)
  })
  it('visible が false のとき false', () => {
    const cols = [{ id: 'reach', label: 'リーチ' }]
    expect(isColumnVisible({ reach: false }, cols, 'reach')).toBe(false)
  })
})
