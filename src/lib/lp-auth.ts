import { createHash } from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'

/**
 * LP APIキー認証ヘルパー
 * x-api-key ヘッダーの値を SHA-256 でハッシュ化し、lp_sites テーブルと照合する。
 * 認証成功時は lp_site を返す。
 */
export async function authenticateLpRequest(
  request: Request,
  supabase: SupabaseClient
): Promise<{ lpSite: LpSiteRow; error: null } | { lpSite: null; error: Response }> {
  // x-api-key ヘッダー優先。sendBeacon はヘッダー不可のため URL クエリパラメータ ?apiKey= をフォールバックとして使用
  const apiKey =
    request.headers.get('x-api-key') ??
    new URL(request.url).searchParams.get('apiKey')

  if (!apiKey) {
    return {
      lpSite: null,
      error: new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'APIキーが必要です' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }

  const keyHash = createHash('sha256').update(apiKey).digest('hex')

  const { data: lpSite, error } = await supabase
    .from('lp_sites')
    .select('id, service_id, lp_code, lp_name, target_url, session_timeout_minutes, is_active')
    .eq('api_auth_key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (error || !lpSite) {
    return {
      lpSite: null,
      error: new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: '無効なAPIキーです' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }

  return { lpSite: lpSite as LpSiteRow, error: null }
}

export interface LpSiteRow {
  id: string
  service_id: string
  lp_code: string
  lp_name: string
  target_url: string
  session_timeout_minutes: number
  is_active: boolean
}
