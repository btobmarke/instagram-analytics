// ==============================
// Supabase DB Types
// ==============================

export interface IgAccount {
  id: string
  platform_account_id: string
  facebook_page_id: string | null
  username: string
  account_name: string | null
  account_type: 'BUSINESS' | 'CREATOR'
  biography: string | null
  profile_picture_url: string | null
  website: string | null
  followers_count: number | null
  follows_count: number | null
  media_count: number | null
  status: 'active' | 'paused' | 'disconnected'
  display_order: number
  connected_at: string
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface IgAccountToken {
  id: string
  account_id: string
  token_type: 'short_lived' | 'long_lived'
  access_token: string
  expires_at: string | null
  scopes: string[] | null
  is_active: boolean
  last_verified_at: string | null
}

export interface IgMedia {
  id: string
  account_id: string
  platform_media_id: string
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  media_product_type: 'FEED' | 'REELS' | 'STORY' | 'AD' | null
  caption: string | null
  permalink: string | null
  thumbnail_url: string | null
  media_url: string | null
  children_json: unknown | null
  posted_at: string
  is_deleted: boolean
  is_comment_enabled: boolean | null
  shortcode: string | null
  inserted_at: string
  updated_at: string
}

export interface IgMediaInsightFact {
  id: string
  media_id: string
  metric_code: string
  period_code: string
  snapshot_at: string
  value: number | null
}

export interface IgAccountInsightFact {
  id: string
  account_id: string
  metric_code: string
  dimension_code: string | null
  dimension_value: string | null
  period_code: string
  value_date: string
  value: number | null
  fetched_at: string
}

export interface KpiMaster {
  id: string
  kpi_code: string
  kpi_name: string
  category: 'engagement' | 'reach' | 'growth' | 'content' | 'conversion'
  capability_type: 'DIRECT_API' | 'DERIVED' | 'MANUAL_INPUT' | 'UNAVAILABLE_NOW'
  formula_type: 'ratio' | 'delta' | 'sum' | 'avg' | 'custom' | null
  numerator_source: string | null
  denominator_source: string | null
  formula_expression: string | null
  subject_level: 'media' | 'account_daily' | 'account_weekly' | 'account_monthly'
  media_scope: string | null
  unit_type: 'count' | 'rate' | 'percent' | 'index'
  higher_is_better: boolean
  is_active: boolean
  display_order: number
  description: string | null
}

export interface KpiResult {
  id: string
  account_id: string
  media_id: string | null
  kpi_id: string
  grain: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'lifetime'
  subject_type: 'media' | 'account'
  period_start: string
  period_end: string
  actual_value: number | null
  source_status: 'complete' | 'partial' | 'waiting_data' | 'unsupported' | 'manual_required'
  calculated_at: string
  calc_version: string
}

export interface KpiTarget {
  id: string
  account_id: string
  kpi_id: string
  target_name: string
  grain: string
  start_date: string
  end_date: string | null
  target_value: number
  warning_threshold: number | null
  critical_threshold: number | null
  scope_json: Record<string, unknown> | null
}

export interface KpiProgress {
  id: string
  account_id: string
  kpi_result_id: string | null
  kpi_target_id: string | null
  actual_value: number | null
  target_value: number | null
  gap_value: number | null
  achievement_rate: number | null
  status: 'achieved' | 'on_track' | 'warning' | 'critical' | 'insufficient_data'
  evaluated_at: string
}

export interface AnalysisPromptSetting {
  id: string
  prompt_type: 'post_analysis' | 'post_comparison' | 'account_weekly' | 'account_monthly'
  prompt_text: string
  algorithm_info: string | null
  algorithm_fetched_at: string | null
  is_active: boolean
  version: number
}

export interface AiAnalysisResult {
  id: string
  account_id: string
  analysis_type: string
  media_ids: string[] | null
  analysis_result: string
  model_used: string | null
  tokens_used: number | null
  target_period_start: string | null
  target_period_end: string | null
  triggered_by: 'user' | 'batch_weekly' | 'batch_monthly'
  created_at: string
}

export interface BatchJobLog {
  id: string
  job_name: string
  account_id: string | null
  status: 'running' | 'success' | 'partial' | 'failed'
  records_processed: number
  records_failed: number
  error_message: string | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
}

export interface AccountKpiSettings {
  id: string
  account_id: string
  target_followers: number | null
  target_engagement_rate: number | null
  target_reach_per_post: number | null
  target_saves_per_post: number | null
  target_posts_per_week: number | null
  target_monthly_follower_gain: number | null
}

export interface AccountStrategySettings {
  id: string
  account_id: string
  strategy_text: string | null
}

// ==============================
// API Response Types
// ==============================

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

export interface PostListItem extends IgMedia {
  latest_reach: number | null
  latest_likes: number | null
  latest_saves: number | null
}

export interface PostDetail extends IgMedia {
  latest_insights: Record<string, number | null>
  latest_ai_analysis: AiAnalysisResult | null
}

export interface ChartDataPoint {
  time: string
  [metric: string]: string | number | null
}

export interface KpiSummaryItem {
  kpi: KpiMaster
  actual_value: number | null
  target_value: number | null
  achievement_rate: number | null
  status: KpiProgress['status']
}

export type MetricCode =
  | 'reach' | 'impressions' | 'likes' | 'comments'
  | 'saved' | 'shares' | 'video_views' | 'total_interactions'
  | 'profile_visits' | 'follows'

export type TimeGrain = 'hourly' | '12h' | 'daily'
