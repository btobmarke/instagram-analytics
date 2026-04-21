import { createHash } from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { getClientIpFromRequest } from '@/lib/request-ip'
import { ipv4MatchesAnyCidr } from '@/lib/lp-ip-exclude'

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

  const { data: row, error } = await supabase
    .from('lp_sites')
    .select(
      `
      id, service_id, lp_code, lp_name, target_url, session_timeout_minutes, is_active,
      services!inner(
        deleted_at,
        projects!inner(
          clients!inner ( lp_ma_ip_exclude_cidr )
        )
      )
    `
    )
    .eq('api_auth_key_hash', keyHash)
    .eq('is_active', true)
    .is('services.deleted_at', null)
    .single()

  if (error || !row) {
    return {
      lpSite: null,
      error: new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: '無効なAPIキーです' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }

  const excludeCidrs = pickLpMaIpExcludeCidrs(row as LpAuthJoinRow)
  const clientIp = getClientIpFromRequest(request)
  if (clientIp && ipv4MatchesAnyCidr(clientIp, excludeCidrs)) {
    return {
      lpSite: null,
      error: new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'LP_IP_EXCLUDED',
            message: 'この送信元はクライアント設定により計測対象外です',
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }

  const lpSite = flattenLpSiteRow(row as LpAuthJoinRow)
  return { lpSite, error: null }
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

type LpAuthJoinRow = LpSiteRow & {
  services:
    | {
        deleted_at: string | null
        projects:
          | { clients: { lp_ma_ip_exclude_cidr: unknown } | { lp_ma_ip_exclude_cidr: unknown }[] | null }
          | { clients: { lp_ma_ip_exclude_cidr: unknown } | { lp_ma_ip_exclude_cidr: unknown }[] | null }[]
          | null
      }
    | {
        deleted_at: string | null
        projects:
          | { clients: { lp_ma_ip_exclude_cidr: unknown } | { lp_ma_ip_exclude_cidr: unknown }[] | null }
          | { clients: { lp_ma_ip_exclude_cidr: unknown } | { lp_ma_ip_exclude_cidr: unknown }[] | null }[]
          | null
      }[]
    | null
}

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function pickLpMaIpExcludeCidrs(row: LpAuthJoinRow): string[] {
  const service = pickFirst(row.services)
  const project = pickFirst(service?.projects)
  const client = pickFirst(project?.clients as { lp_ma_ip_exclude_cidr?: unknown } | { lp_ma_ip_exclude_cidr?: unknown }[] | null | undefined)
  const raw = (client as { lp_ma_ip_exclude_cidr?: unknown } | null)?.lp_ma_ip_exclude_cidr
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

function flattenLpSiteRow(row: LpAuthJoinRow): LpSiteRow {
  return {
    id: row.id,
    service_id: row.service_id,
    lp_code: row.lp_code,
    lp_name: row.lp_name,
    target_url: row.target_url,
    session_timeout_minutes: row.session_timeout_minutes,
    is_active: row.is_active,
  }
}
