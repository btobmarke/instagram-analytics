import { google } from 'googleapis'
import { decrypt } from '@/lib/utils/crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export async function getGoogleAdsAccessToken(clientId: string): Promise<string> {
  const admin = createSupabaseAdminClient()
  const { data: cred, error } = await admin
    .from('client_google_ads_credentials')
    .select('oauth_client_id_enc, oauth_client_secret_enc, refresh_token_enc')
    .eq('client_id', clientId)
    .eq('auth_status', 'active')
    .single()

  if (error || !cred) throw new Error('Google Ads credentials not found')
  if (!cred.refresh_token_enc) throw new Error('Google Ads refresh token not found')

  const oauth2 = new google.auth.OAuth2(
    decrypt(cred.oauth_client_id_enc),
    decrypt(cred.oauth_client_secret_enc)
  )
  oauth2.setCredentials({ refresh_token: decrypt(cred.refresh_token_enc) })
  const { token } = await oauth2.getAccessToken()
  if (!token) throw new Error('Failed to get access token')
  return token
}

