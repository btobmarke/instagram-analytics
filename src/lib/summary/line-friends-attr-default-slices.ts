import type { BreakdownSliceSpec } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'

/**
 * LINE OAM の demographic CSV でよくある表記に合わせたプリセット。
 * 実データの gender / age 文字列と一致しない場合はテンプレ編集で修正してください。
 */
export const DEFAULT_LINE_FRIENDS_ATTR_SLICES: BreakdownSliceSpec[] = [
  { label: '男性', gender: 'male' },
  { label: '女性', gender: 'female' },
  { label: '男性 20〜24', gender: 'male', age: '20〜24歳' },
  { label: '女性 20〜24', gender: 'female', age: '20〜24歳' },
  { label: '男性 25〜29', gender: 'male', age: '25〜29歳' },
  { label: '女性 25〜29', gender: 'female', age: '25〜29歳' },
]
