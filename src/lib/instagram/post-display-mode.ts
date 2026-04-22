import type { IgMedia } from '@/types'

/** 投稿一覧・詳細の「フィード系 / ストーリー」表示モード */
export type PostListMode = 'feed' | 'story'

export function isStoryMedia(post: Pick<IgMedia, 'media_product_type' | 'media_type'>): boolean {
  return (post.media_product_type ?? post.media_type) === 'STORY'
}

export function postListModeFromQueryParam(
  type: string | null,
  mode: string | null
): PostListMode {
  if (mode === 'story' || mode === 'feed') return mode
  if (type === 'STORY') return 'story'
  return 'feed'
}

/** API `type` に渡す値（feed = FEED+REELS+VIDEO） */
export function apiTypeParamForListMode(mode: PostListMode): string | undefined {
  if (mode === 'story') return 'STORY'
  return undefined
}

/** ストーリー向けの既定グラフ指標（API で取得しているもの） */
export const STORY_DEFAULT_CHART_METRICS = ['reach', 'views', 'exits', 'replies'] as const

/** フィード系の既定グラフ指標 */
export const FEED_DEFAULT_CHART_METRICS = ['reach', 'likes', 'saved'] as const

export function defaultChartMetricsForPost(
  post: Pick<IgMedia, 'media_product_type' | 'media_type'>
): string[] {
  return isStoryMedia(post) ? [...STORY_DEFAULT_CHART_METRICS] : [...FEED_DEFAULT_CHART_METRICS]
}

export function milestoneMetricsForPost(
  post: Pick<IgMedia, 'media_product_type' | 'media_type'>,
  availableKeys: string[]
): string[] {
  if (isStoryMedia(post)) {
    const prefer = ['reach', 'views', 'exits', 'replies', 'taps_forward', 'taps_back']
    return prefer.filter(m => availableKeys.includes(m))
  }
  return ['reach', 'likes', 'saved'].filter(m => availableKeys.includes(m))
}

/** オーバーレイ比較で選べる指標 */
export const OVERLAY_METRICS_FEED = ['reach', 'likes', 'saved', 'comments', 'impressions', 'views'] as const
export const OVERLAY_METRICS_STORY = ['reach', 'views', 'exits', 'replies', 'taps_forward', 'taps_back'] as const

export type OverlayMetricFeed = (typeof OVERLAY_METRICS_FEED)[number]
export type OverlayMetricStory = (typeof OVERLAY_METRICS_STORY)[number]

export function overlayMetricChoicesForPost(
  post: Pick<IgMedia, 'media_product_type' | 'media_type'>
): readonly string[] {
  return isStoryMedia(post) ? OVERLAY_METRICS_STORY : OVERLAY_METRICS_FEED
}

export function overlayDiffMetricsForPost(
  post: Pick<IgMedia, 'media_product_type' | 'media_type'>
): string[] {
  if (isStoryMedia(post)) {
    return ['reach', 'views', 'exits'].filter(m =>
      (OVERLAY_METRICS_STORY as readonly string[]).includes(m)
    )
  }
  return ['reach', 'likes', 'saved']
}

export function insightPhaseOptionsForPost(
  post: Pick<IgMedia, 'media_product_type' | 'media_type'>
): 'default' | 'story' {
  return isStoryMedia(post) ? 'story' : 'default'
}
