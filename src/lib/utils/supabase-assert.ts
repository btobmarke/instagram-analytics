import type { PostgrestError } from '@supabase/supabase-js'

/** supabase の insert/update/upsert 結果で error があれば例外にする（握りつぶし防止） */
export function throwOnDbError(label: string, result: { error: PostgrestError | null }): void {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message} (code=${result.error.code})`)
  }
}
