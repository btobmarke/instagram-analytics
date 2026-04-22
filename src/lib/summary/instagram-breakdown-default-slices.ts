import type { IgAccountInsightBreakdownSlice } from '@/lib/summary/fetch-metrics'

/** フォロワー層（性別）lifetime — dimension_value は収集データに合わせて調整可 */
export const DEFAULT_INSTAGRAM_FOLLOWER_DEMO_SLICES: IgAccountInsightBreakdownSlice[] = [
  { label: 'フォロワー（女性）', dimension_code: 'gender', dimension_value: 'FEMALE' },
  { label: 'フォロワー（男性）', dimension_code: 'gender', dimension_value: 'MALE' },
]

/** エンゲージ層（性別）lifetime */
export const DEFAULT_INSTAGRAM_ENGAGED_DEMO_SLICES: IgAccountInsightBreakdownSlice[] = [
  { label: 'エンゲージ（女性）', dimension_code: 'gender', dimension_value: 'FEMALE' },
  { label: 'エンゲージ（男性）', dimension_code: 'gender', dimension_value: 'MALE' },
]
