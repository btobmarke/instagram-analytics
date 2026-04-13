// ── 共有型定義 ──────────────────────────────────────────────────

export interface ServiceDetail {
  id: string
  service_name: string
  service_type: string
  project: { id: string; project_name: string }
}

/** カード（指標候補） */
export interface MetricCard {
  id: string           // "テーブル名.フィールド名" 形式
  label: string        // 日本語表示名
  category: string     // カテゴリ（テーブル単位）
  fieldRef: string     // DB生フィールド名
  description?: string // 指標の説明文
  formula?: FormulaNode
}

/** 計算式: 複数ステップ対応 */
export type FormulaOperator = '+' | '-' | '*' | '/'

export interface FormulaStep {
  operator: FormulaOperator
  operandId: string
}

/** 計算結果に適用する閾値（LINE カスタム指標など）。満たさないときは null 扱い */
export type FormulaThresholdMode = 'none' | 'gte' | 'lte'

export interface FormulaNode {
  baseOperandId: string
  steps: FormulaStep[]
  /** 演算後の値が条件を満たすときだけ表示（満たさないセルは —） */
  thresholdMode?: FormulaThresholdMode
  /** thresholdMode が gte / lte のとき必須 */
  thresholdValue?: number | null
}

export const OPERATOR_SYMBOLS: Record<FormulaOperator, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
}

/** 式を人間可読な文字列に変換 */
export function formatFormula(
  formula: FormulaNode,
  findLabel: (id: string) => string,
  mode: 'label' | 'id' = 'label',
): string {
  const get = mode === 'label' ? findLabel : (id: string) => id
  const parts: string[] = [get(formula.baseOperandId)]
  let needsGroup = false
  for (let i = 0; i < formula.steps.length; i++) {
    const s = formula.steps[i]
    if (i > 0 && (s.operator === '*' || s.operator === '/') && !needsGroup) {
      const prevOps = formula.steps.slice(0, i).map(p => p.operator)
      if (prevOps.some(o => o === '+' || o === '-')) {
        parts.unshift('(')
        parts.push(')')
        needsGroup = true
      }
    }
    parts.push(` ${OPERATOR_SYMBOLS[s.operator]} `)
    parts.push(get(s.operandId))
  }
  let out = parts.join('')
  const tm = formula.thresholdMode ?? 'none'
  if (tm === 'gte' && formula.thresholdValue != null) {
    out += ` （閾値以上: ${formula.thresholdValue}）`
  } else if (tm === 'lte' && formula.thresholdValue != null) {
    out += ` （閾値以下: ${formula.thresholdValue}）`
  }
  return out
}

/** テーブルの行 */
export interface TableRow {
  id: string
  label: string
  cells: Record<string, string>
}

export type TimeUnit = 'hour' | 'day' | 'week' | 'month' | 'custom_range'

export const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  hour: '1 時間',
  day:  '1 日',
  week: '1 週間',
  month:'1 ヶ月',
  custom_range: '期間指定（YYYYMMDD~YYYYMMDD）',
}

// ── テンプレート保存形式 ──────────────────────────────────────

export interface StoredTemplateRow {
  id: string
  label: string
  formula?: FormulaNode   // カスタム指標の場合
}

export interface SummaryTemplate {
  id: string
  serviceId: string
  name: string
  timeUnit: TimeUnit
  /** timeUnit === custom_range のとき YYYY-MM-DD */
  rangeStart?: string | null
  rangeEnd?: string | null
  rows: StoredTemplateRow[]
  customCards: MetricCard[]
  createdAt: string
  updatedAt: string
}
