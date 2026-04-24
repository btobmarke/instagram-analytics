/** サマリーカスタム指標の式（クライアント・API・eval 共有） */

export type FormulaBinaryOperator = '+' | '-' | '*' | '/'
export type FormulaNAryOperator = 'min' | 'max' | 'coalesce'

/** オペランドの時間シフト（同一指標の前期比較） */
export type FormulaOperandTimeOp = 'none' | 'lag1' | 'diff_prev'

export interface FormulaStep {
  operator: FormulaBinaryOperator | FormulaNAryOperator
  operandId: string
  /** true のとき operandId を数値定数として解釈 */
  operandIsConst?: boolean
  /** メトリクスオペランドに対する時間変換（定数では無視） */
  operandTimeOp?: FormulaOperandTimeOp
  /** min / max / coalesce で 3 項以上に使う追加オペランド（metric id または定数文字列） */
  extraOperandIds?: string[]
  /** extraOperandIds の各要素が定数か（長さは extraOperandIds と一致させる） */
  extraOperandsAreConst?: boolean[]
}

export type FormulaThresholdMode = 'none' | 'gte' | 'lte'

/** LINE ショップカード「ポイント分布」: 対象日までの累計 users（point 軸で比較） */
export type CumulativeUsersCompareOp = 'eq' | 'gte' | 'lte' | 'gt' | 'lt'

export interface FormulaNode {
  baseOperandId: string
  /** true のとき baseOperandId を数値定数として解釈 */
  baseOperandIsConst?: boolean
  /** ベース指標の時間変換（定数では無視） */
  baseTimeOp?: FormulaOperandTimeOp
  steps: FormulaStep[]
  thresholdMode?: FormulaThresholdMode
  thresholdValue?: number | null
  /**
   * 設定時は「ポイント分布スライス人数」として評価し、値は `line_oam_shopcard_point.cumulative_users@op:threshold` のキーで取得する。
   * 通常の四則ステップは無視される（API では steps はダミー 1 段で保存される）。
   */
  cumulativeUsersSliceRef?: string | null
}

export const OPERATOR_SYMBOLS: Record<FormulaBinaryOperator, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
}

export const NARY_OPERATOR_LABELS: Record<FormulaNAryOperator, string> = {
  min: '最小',
  max: '最大',
  coalesce: '先頭の有効値',
}

/** セレクトボックス用（サマリ表の横軸＝列であることを明示） */
export const TIME_OP_LABELS: Record<FormulaOperandTimeOp, string> = {
  none: 'この列の値（いつもどおり）',
  lag1: '左の列の同じ指標の値',
  diff_prev: 'この列 − 左の列（同じ指標）',
}
