import { createClient, SupabaseClient } from '@supabase/supabase-js'

// 遅延初期化（ビルド時に環境変数が未設定でもエラーにならないように）
let _supabaseAdmin: SupabaseClient | null = null

export function createSupabaseAdminClient(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error('Supabase admin environment variables are not set')
    }
    _supabaseAdmin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return _supabaseAdmin
}

// 後方互換性のためのエクスポート（使用箇所が関数呼び出しに移行済みであれば不要）
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return createSupabaseAdminClient()[prop as keyof SupabaseClient]
  },
})
