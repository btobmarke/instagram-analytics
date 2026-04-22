import { describe, expect, it } from 'vitest'
import {
  apiTypeParamForListMode,
  defaultChartMetricsForPost,
  isStoryMedia,
  postListModeFromQueryParam,
} from '@/lib/instagram/post-display-mode'

describe('postListModeFromQueryParam', () => {
  it('mode が優先される', () => {
    expect(postListModeFromQueryParam('FEED', 'story')).toBe('story')
  })
  it('type=STORY はストーリーモード', () => {
    expect(postListModeFromQueryParam('STORY', null)).toBe('story')
  })
  it('未指定はフィード系', () => {
    expect(postListModeFromQueryParam('', null)).toBe('feed')
  })
})

describe('apiTypeParamForListMode', () => {
  it('ストーリーのみ type を返す', () => {
    expect(apiTypeParamForListMode('story')).toBe('STORY')
    expect(apiTypeParamForListMode('feed')).toBeUndefined()
  })
})

describe('isStoryMedia / defaultChartMetricsForPost', () => {
  it('STORY を判定する', () => {
    expect(isStoryMedia({ media_product_type: 'STORY', media_type: 'IMAGE' })).toBe(true)
    expect(isStoryMedia({ media_product_type: 'FEED', media_type: 'IMAGE' })).toBe(false)
  })
  it('既定メトリクスが種別で変わる', () => {
    expect(defaultChartMetricsForPost({ media_product_type: 'STORY', media_type: 'IMAGE' })).toEqual([
      'reach',
      'views',
      'exits',
      'replies',
    ])
    expect(defaultChartMetricsForPost({ media_product_type: 'FEED', media_type: 'IMAGE' })).toEqual([
      'reach',
      'likes',
      'saved',
    ])
  })
})
