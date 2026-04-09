import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * サービスが存在し Instagram 種別であることを確認し、紐づく ig_accounts.id を返す。
 */
export async function resolveInstagramAccountIdForService(
  supabase: SupabaseClient,
  serviceId: string
): Promise<{ accountId: string } | { error: string; status: number }> {
  const { data: service, error } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .is('deleted_at', null)
    .single()

  if (error || !service) {
    return { error: 'サービスが見つかりません', status: 404 }
  }
  if (service.service_type !== 'instagram') {
    return { error: 'Instagram サービスではありません', status: 400 }
  }

  const { data: ig, error: igErr } = await supabase
    .from('ig_accounts')
    .select('id')
    .eq('service_id', serviceId)
    .maybeSingle()

  if (igErr) {
    return { error: igErr.message, status: 500 }
  }
  if (!ig?.id) {
    return { error: 'Instagram アカウントが未連携です', status: 400 }
  }

  return { accountId: ig.id }
}
