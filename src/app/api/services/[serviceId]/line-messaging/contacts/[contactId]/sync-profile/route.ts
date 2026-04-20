import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { decrypt } from '@/lib/utils/crypto'
import { syncLineUserProfileToContact } from '@/lib/line/sync-line-user-profile'

type Params = { params: Promise<{ serviceId: string; contactId: string }> }

/**
 * POST — LINE Get profile でコンタクトの表示名・画像等を更新
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { serviceId, contactId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: cred } = await admin
    .from('line_messaging_service_credentials')
    .select('channel_access_token_enc')
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!cred?.channel_access_token_enc) {
    return NextResponse.json({ error: 'messaging_not_configured' }, { status: 400 })
  }

  let token: string
  try {
    token = decrypt(cred.channel_access_token_enc)
  } catch {
    return NextResponse.json({ error: 'credential_error' }, { status: 500 })
  }

  const { data: row, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('id, line_user_id')
    .eq('id', contactId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (cErr || !row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const sync = await syncLineUserProfileToContact(admin, serviceId, row.id, row.line_user_id, token)
  if (!sync.ok) {
    return NextResponse.json(
      { error: 'profile_sync_failed', message: sync.error, status: sync.status },
      { status: sync.status && sync.status >= 400 && sync.status < 600 ? sync.status : 502 },
    )
  }

  const { data: updated, error: uErr } = await admin
    .from('line_messaging_contacts')
    .select(
      'id, line_user_id, display_name, picture_url, line_status_message, line_language, profile_fetched_at, is_followed, lead_status, ops_memo, assignee_app_user_id, first_seen_at, last_interaction_at',
    )
    .eq('id', contactId)
    .maybeSingle()

  if (uErr || !updated) return NextResponse.json({ error: uErr?.message ?? 'fetch_failed' }, { status: 500 })
  return NextResponse.json({ success: true, data: updated })
}
