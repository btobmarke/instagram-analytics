// ============================================================
// GBP 定数定義
// ============================================================

export const GBP_OAUTH_BASE = 'https://accounts.google.com/o/oauth2'
export const GBP_TOKEN_URL  = 'https://oauth2.googleapis.com/token'
export const GBP_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export const GBP_API_BASE   = 'https://businessprofileperformance.googleapis.com'
export const GBP_ACCOUNT_API_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1'
export const GBP_INFO_API_BASE    = 'https://mybusinessbusinessinformation.googleapis.com/v1'
export const GBP_REVIEWS_API_BASE = 'https://mybusiness.googleapis.com/v4'

// 必要なスコープ
export const GBP_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'openid',
  'email',
]

// DATA_LAYOUT.md / ALL_DAILY_METRICS に対応する11指標
export const ALL_DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_FOOD_ORDERS',
  'BUSINESS_FOOD_MENU_CLICKS',
] as const

export type DailyMetric = typeof ALL_DAILY_METRICS[number]

// DB列名 ↔ APIメトリクス名のマッピング
export const METRIC_TO_COLUMN: Record<DailyMetric, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'business_impressions_desktop_search',
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH:  'business_impressions_mobile_search',
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS:   'business_impressions_desktop_maps',
  BUSINESS_IMPRESSIONS_MOBILE_MAPS:    'business_impressions_mobile_maps',
  BUSINESS_CONVERSATIONS:              'business_conversations',
  BUSINESS_DIRECTION_REQUESTS:         'business_direction_requests',
  CALL_CLICKS:                         'call_clicks',
  WEBSITE_CLICKS:                      'website_clicks',
  BUSINESS_BOOKINGS:                   'business_bookings',
  BUSINESS_FOOD_ORDERS:                'business_food_orders',
  BUSINESS_FOOD_MENU_CLICKS:           'business_food_menu_clicks',
}
