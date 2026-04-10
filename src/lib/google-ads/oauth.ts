import { GOOGLE_ADS_OAUTH_BASE, GOOGLE_OAUTH_TOKEN_URL, GOOGLE_ADS_SCOPE } from './constants'

export interface GoogleOAuthTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type: string
  id_token?: string
}

export function buildGoogleAdsOAuthUrl(params: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: GOOGLE_ADS_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: params.state,
  })
  return `${GOOGLE_ADS_OAUTH_BASE}/auth?${query.toString()}`
}

export async function exchangeCodeForTokens(params: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<GoogleOAuthTokenResponse> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${body}`)
  }
  return res.json() as Promise<GoogleOAuthTokenResponse>
}

