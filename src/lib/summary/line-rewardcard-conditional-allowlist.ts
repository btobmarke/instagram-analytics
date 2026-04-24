/**
 * LINE リワードカード系テーブルの「条件付き集計」ホワイトリスト（UI / fetch 共通）
 */

export const LINE_REWARDCARD_COND_AGG_TABLES = [
  'line_oam_shopcard_point',
  'line_oam_shopcard_status',
] as const

export type LineRewardcardCondAggTableName = (typeof LINE_REWARDCARD_COND_AGG_TABLES)[number]

type TableSpec = {
  label: string
  /** DB の日付列（JST 暦日と一致する DATE） */
  dateColumn: 'date'
  /** 数値比較・合算に使える列（deleted / name 等は含めない） */
  numericFields: readonly string[]
}

export const LINE_REWARDCARD_COND_AGG_TABLE_SPEC: Record<LineRewardcardCondAggTableName, TableSpec> = {
  line_oam_shopcard_point: {
    label: 'ポイント分布',
    dateColumn: 'date',
    numericFields: ['point', 'users'],
  },
  line_oam_shopcard_status: {
    label: 'ショップカード状態',
    dateColumn: 'date',
    numericFields: [
      'valid_cards',
      'issued_cards',
      'store_visit_points',
      'welcome_bonuses_awarded',
      'expired_points',
      'vouchers_awarded',
      'vouchers_used',
    ],
  },
}

export function isLineRewardcardCondAggTableName(s: string): s is LineRewardcardCondAggTableName {
  return (LINE_REWARDCARD_COND_AGG_TABLES as readonly string[]).includes(s)
}
