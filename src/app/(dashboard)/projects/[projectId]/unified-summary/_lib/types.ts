// ── 横断サマリーテンプレート 型定義 ──────────────────────────────────────────

export type TimeUnit = 'hour' | 'day' | 'week' | 'month' | 'custom_range'

export const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  hour:         '1 時間',
  day:          '1 日',
  week:         '1 週間',
  month:        '1 ヶ月',
  custom_range: '期間指定',
}

export const TIME_UNIT_DEFAULT_COUNT: Record<TimeUnit, number> = {
  hour:         24,
  day:          14,
  week:         8,
  month:        6,
  custom_range: 1,
}

// ── 指標カード（サービスのカタログ定義と互換） ──────────────────────────────

export interface MetricCard {
  id: string        // "テーブル名.フィールド名" 形式
  label: string     // 日本語表示名
  category: string  // カテゴリ（テーブル単位）
  fieldRef: string  // DB フィールド名
  description?: string
}

// ── テンプレート行（横断サマリー固有：serviceId を持つ） ──────────────────────

export interface UnifiedTableRow {
  id: string          // ユニーク行 ID（UUID）
  serviceId: string   // どのサービスのデータか
  serviceType: string // 'instagram' | 'gbp' | 'line' | 'lp' | 'google_ads' ...
  metricRef: string   // 'ig_account_insight_fact.follower_count' など
  label: string       // テーブルに表示するラベル（カスタム変更可）
}

// ── テンプレート本体 ─────────────────────────────────────────────────────────

export interface ProjectSummaryTemplate {
  id: string
  projectId: string
  name: string
  timeUnit: TimeUnit
  count: number
  rangeStart?: string | null
  rangeEnd?: string | null
  rows: UnifiedTableRow[]
  createdAt: string
  updatedAt: string
}

// ── DB Row → フロント型 変換 ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToTemplate(r: any): ProjectSummaryTemplate {
  return {
    id:         r.id,
    projectId:  r.project_id,
    name:       r.name,
    timeUnit:   r.time_unit as TimeUnit,
    count:      r.count,
    rangeStart: r.range_start ?? null,
    rangeEnd:   r.range_end   ?? null,
    rows:       Array.isArray(r.rows) ? r.rows : [],
    createdAt:  r.created_at,
    updatedAt:  r.updated_at,
  }
}

// ── サービス表示情報 ──────────────────────────────────────────────────────────

export const SERVICE_TYPE_INFO: Record<string, {
  label: string
  abbr:  string
  icon:  string
  color: string
  bgColor: string
  badgeClass: string
}> = {
  instagram: {
    label:      'Instagram',
    abbr:       'IG',
    icon:       '📸',
    color:      'text-pink-700',
    bgColor:    'bg-pink-50 border-pink-200',
    badgeClass: 'bg-pink-100 text-pink-700',
  },
  gbp: {
    label:      'GBP',
    abbr:       'GBP',
    icon:       '🏢',
    color:      'text-teal-700',
    bgColor:    'bg-teal-50 border-teal-200',
    badgeClass: 'bg-teal-100 text-teal-700',
  },
  line: {
    label:      'LINE',
    abbr:       'LINE',
    icon:       '💬',
    color:      'text-green-700',
    bgColor:    'bg-green-50 border-green-200',
    badgeClass: 'bg-green-100 text-green-700',
  },
  lp: {
    label:      'LP',
    abbr:       'LP',
    icon:       '🎯',
    color:      'text-orange-700',
    bgColor:    'bg-orange-50 border-orange-200',
    badgeClass: 'bg-orange-100 text-orange-700',
  },
  google_ads: {
    label:      'Google広告',
    abbr:       'GAds',
    icon:       '🔍',
    color:      'text-blue-700',
    bgColor:    'bg-blue-50 border-blue-200',
    badgeClass: 'bg-blue-100 text-blue-700',
  },
  ga4: {
    label:      'GA4',
    abbr:       'GA4',
    icon:       '📊',
    color:      'text-indigo-700',
    bgColor:    'bg-indigo-50 border-indigo-200',
    badgeClass: 'bg-indigo-100 text-indigo-700',
  },
}
