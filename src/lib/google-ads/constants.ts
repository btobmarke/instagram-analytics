export const GOOGLE_ADS_OAUTH_BASE = 'https://accounts.google.com/o/oauth2' as const
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token' as const

export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords' as const

/** サンセット済みの古い v は 404 になるため、定期的に https://developers.google.com/google-ads/api/docs/sunset-dates を参照して更新すること */
export const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v23' as const

