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

// ==============================
// Phase 2: 業務管理系
// ==============================

export type ServiceType =
  | 'instagram' | 'lp' | 'x' | 'line'
  | 'google_ads' | 'meta_ads' | 'gbp' | 'owned_media' | 'summary'

export interface Client {
  id: string
  client_name: string
  note: string | null
  is_active: boolean
  /** Anthropic API のモデル ID（例: claude-sonnet-4-6） */
  ai_model?: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  client_id: string
  project_name: string
  note: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Service {
  id: string
  project_id: string
  service_type: ServiceType
  service_name: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface InstagramAccount {
  id: string
  service_id: string
  ig_account_ref_id: string | null
  instagram_account_id: string | null
  username: string | null
  display_name: string | null
  status: string
  created_at: string
  updated_at: string
}

// ==============================
// Phase 2: LP計測系
// ==============================

export type UserTemperature = 'HOT' | 'COLD'
export type RangeType = 'all' | '30d' | '7d' | 'today'
export type SourceType = 'MA' | 'GA4' | 'CLARITY'

export interface LpSite {
  id: string
  service_id: string
  lp_code: string
  lp_name: string
  target_url: string
  session_timeout_minutes: number
  api_auth_key_hash: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface LpUser {
  id: string
  lp_site_id: string
  anonymous_user_key: string
  first_visited_at: string
  last_visited_at: string
  visit_count: number
  total_intent_score: number
  user_temperature: UserTemperature
  created_at: string
  updated_at: string
}

export interface LpSession {
  id: string
  lp_user_id: string
  lp_site_id: string
  session_no: number
  started_at: string
  ended_at: string | null
  last_activity_at: string
  session_intent_score: number
  interaction_count: number
  referrer_source: string | null
  landing_page_url: string | null
  exit_page_url: string | null
  duration_seconds: number
  created_at: string
  updated_at: string
}

export interface LpPageView {
  id: string
  lp_session_id: string
  lp_site_id: string
  occurred_at: string
  page_url: string
  page_path: string | null
  page_title: string | null
  scroll_percent_max: number | null
  stay_seconds: number | null
  created_at: string
}

export interface LpEventRule {
  id: string
  lp_site_id: string
  event_id: string
  event_name: string
  intent_type: string
  intent_score: number
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export interface LpEventLog {
  id: string
  lp_site_id: string
  lp_user_id: string
  lp_session_id: string
  event_rule_id: string | null
  raw_event_id: string
  event_name_snapshot: string | null
  intent_score_snapshot: number
  page_url: string | null
  referrer_source: string | null
  scroll_percent: number | null
  meta_json: Record<string, unknown>
  occurred_at: string
  created_at: string
}

export interface LpScoringSettings {
  id: string
  lp_site_id: string
  hot_threshold: number
  cold_threshold: number | null
  effective_from: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// ==============================
// Phase 2: 外部連携・集計系
// ==============================

export interface ServiceIntegration {
  id: string
  service_id: string
  integration_type: 'GA4' | 'CLARITY' | 'INSTAGRAM'
  external_project_id: string | null
  encrypted_credential: string | null
  last_synced_at: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface ExternalFetchLog {
  id: string
  service_id: string
  integration_type: string
  fetch_target_date: string
  fetch_status: 'SUCCESS' | 'FAILED' | 'PARTIAL'
  response_summary: string | null
  started_at: string
  finished_at: string | null
  created_at: string
}

export interface MetricSummary {
  id: string
  service_id: string
  metric_name: string
  metric_value_numeric: number | null
  metric_value_text: string | null
  range_type: RangeType
  source_type: SourceType
  summary_date: string
  created_at: string
}

export interface RankingSummary {
  id: string
  service_id: string
  ranking_type: 'event' | 'page' | 'exit' | 'referrer' | 'stay_bucket'
  item_key: string
  item_label: string | null
  rank_no: number
  count_value: number
  range_type: RangeType
  source_type: SourceType
  summary_date: string
  created_at: string
}

// ==============================
// Phase 2: API レスポンス型
// ==============================

export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  meta: {
    page: number
    pageSize: number
    totalCount: number
  }
}

export interface ApiSuccessResponse<T> {
  success: true
  data: T
}

export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
  }
}

export type ApiResult<T> = ApiSuccessResponse<T> | ApiErrorResponse

// クライアント詳細（プロジェクト一覧付き）
export interface ClientDetail extends Client {
  projects: Array<Project & { service_count: number }>
}

// プロジェクト詳細（サービス一覧付き）
export interface ProjectDetail extends Project {
  client: Pick<Client, 'id' | 'client_name'>
  services: Service[]
}

// LPサマリー指標
export interface LpMetricItem {
  metric_name: string
  value: number | null
  source_type: SourceType
}

export interface LpRankingItem {
  item_key: string
  item_label: string | null
  rank_no: number
  count_value: number
  source_type: SourceType
}

export interface LpSummaryResponse {
  range: RangeType
  metrics: LpMetricItem[]
  rankings: {
    event: LpRankingItem[]
    page: LpRankingItem[]
    exit: LpRankingItem[]
    referrer: LpRankingItem[]
    stay_bucket: LpRankingItem[]
  }
  fetched_at: string
}

// LPユーザー一覧アイテム
export interface LpUserListItem {
  id: string
  anonymous_user_key: string
  first_visited_at: string
  last_visited_at: string
  visit_count: number
  total_intent_score: number
  user_temperature: UserTemperature
}

// LPユーザー詳細
export interface LpUserDetail extends LpUser {
  sessions: Array<Pick<LpSession, 'id' | 'session_no' | 'started_at' | 'duration_seconds' | 'session_intent_score' | 'referrer_source'>>
}

// LPセッション一覧アイテム
export interface LpSessionListItem {
  id: string
  lp_user_id: string
  session_no: number
  started_at: string
  referrer_source: string | null
  duration_seconds: number
  interaction_count: number
  session_intent_score: number
}

// セッション詳細（行動タイムライン付き）
export type TimelineActionType = 'page_view' | 'event'

export interface TimelineItem {
  type: TimelineActionType
  occurred_at: string
  page_url: string | null
  // page_view 専用
  page_title?: string | null
  scroll_percent_max?: number | null
  stay_seconds?: number | null
  // event 専用
  event_name?: string | null
  intent_score?: number
}

export interface LpSessionDetail extends LpSession {
  user_visit_count: number
  action_logs: TimelineItem[]
}

// LPイベントルール一覧（発火数付き）
export interface LpEventRuleListItem extends LpEventRule {
  fire_count: number
}

// LPイベントルール詳細
export interface LpEventRuleDetail extends LpEventRuleListItem {
  related_sessions: number
  related_users: number
  before_actions: Array<{ action_type: string; count: number }>
  after_actions: Array<{ action_type: string; count: number }>
}

// MA受信API レスポンス
export interface MaIdentifyResponse {
  anonymous_user_key: string
  lp_user_id: string
  session_id: string
  is_new_user: boolean
  is_new_session: boolean
}

export interface MaEventResponse {
  ok: boolean
  session_intent_score: number
  total_intent_score: number
  is_hot: boolean
}
