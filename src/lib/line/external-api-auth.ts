import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ExternalApiScope =
  | 'contacts:read'
  | 'tags:read'
  | 'tags:write'
  | 'broadcast:write'

export async function validateExternalApiKey(
  admin: SupabaseClient,
  serviceId: string,
  authHeader: string | null,
): Promise<
  | { ok: true; keyId: string; scopes: string[] }
  | { ok: false; status: number; error: string }
> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'missing_bearer' }
  }
  const token = authHeader.slice(7).trim()
  if (!token) return { ok: false, status: 401, error: 'empty_token' }

  const hash = createHash('sha256').update(token, 'utf8').digest('hex')

  const { data: row, error } = await admin
    .from('line_messaging_external_api_keys')
    .select('id, scopes, revoked_at')
    .eq('service_id', serviceId)
    .eq('key_hash', hash)
    .maybeSingle()

  if (error) return { ok: false, status: 500, error: error.message }
  if (!row || row.revoked_at) return { ok: false, status: 401, error: 'invalid_key' }

  await admin
    .from('line_messaging_external_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)

  return { ok: true, keyId: row.id, scopes: row.scopes ?? [] }
}

export function requireScope(scopes: string[], need: ExternalApiScope): boolean {
  return scopes.includes(need)
}
