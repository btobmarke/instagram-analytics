// ============================================================
// GBP OAuth ヘルパー
// ============================================================

import { GBP_OAUTH_BASE, GBP_TOKEN_URL, GBP_REVOKE_URL, GBP_SCOPES } from './constants'
import { encrypt, decrypt } from '@/lib/utils/crypto'

export interface GbpTokenResponse {
  access_token:  string
  expires_in:    number
  refresh_token?: string
  scope:         string
  token_type:    string
  id_token?:     string
}

export interface GbpCredentialRow {
  id:                      string
  client_id:               string
  oauth_client_id_enc:     string
  oauth_client_secret_enc: string
  refresh_token_enc:       string
  scopes:                  string | null
  auth_status:             'active' | 'revoked' | 'error'
  google_account_email:    string | null
}

// ------------------------------------------------
// OAuth 同意画面 URL を生成
// ------------------------------------------------
export function buildOAuthUrl(params: {
  clientId:    string
  redirectUri: string
  state:       string
}): string {
  const query = new URLSearchParams({
    client_id:     params.clientId,
    redirect_uri:  params.redirectUri,
    response_type: 'code',
    scope:         GBP_SCOPES.join(' '),
    access_type:   'offline',
    prompt:        'consent',   // 毎回 refresh_token を返させる
    state:         params.state,
  })
  return `${GBP_OAUTH_BASE}/auth?${query}`
}

// ------------------------------------------------
// 認可コード → トークン交換
// ------------------------------------------------
export async function exchangeCodeForTokens(params: {
  code:        string
  clientId:    string
  clientSecret: string
  redirectUri: string
}): Promise<GbpTokenResponse> {
  const res = await fetch(GBP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code:          params.code,
      client_id:     params.clientId,
      client_secret: params.clientSecret,
      redirect_uri:  params.redirectUri,
      grant_type:    'authorization_code',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${body}`)
  }
  return res.json() as Promise<GbpTokenResponse>
}

// ------------------------------------------------
// refresh_token → access_token を取得
// ------------------------------------------------
export async function refreshAccessToken(params: {
  clientId:     string
  clientSecret: string
  refreshToken: string
}): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch(GBP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
      grant_type:    'refresh_token',
    }),
  })
  const json = await res.json() as Record<string, unknown>

  if (!res.ok || json.error) {
    const errMsg = (json.error_description as string) ?? (json.error as string) ?? 'Unknown error'
    throw new Error(`refresh_access_token failed: ${errMsg}`)
  }
  const expiresAt = new Date(Date.now() + (Number(json.expires_in) - 60) * 1000)
  return { accessToken: json.access_token as string, expiresAt }
}

// ------------------------------------------------
// DB の credential レコードから access_token を取得
// ------------------------------------------------
export async function getAccessTokenFromCredential(cred: GbpCredentialRow): Promise<string> {
  const clientId     = decrypt(cred.oauth_client_id_enc)
  const clientSecret = decrypt(cred.oauth_client_secret_enc)
  const refreshToken = decrypt(cred.refresh_token_enc)
  const { accessToken } = await refreshAccessToken({ clientId, clientSecret, refreshToken })
  return accessToken
}

// ------------------------------------------------
// トークン失効（連携解除時）
// ------------------------------------------------
export async function revokeToken(token: string): Promise<void> {
  await fetch(`${GBP_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' })
}

// ------------------------------------------------
// 暗号化ヘルパー（credential保存用）
// ------------------------------------------------
export function encryptCredential(value: string): string {
  return encrypt(value)
}
