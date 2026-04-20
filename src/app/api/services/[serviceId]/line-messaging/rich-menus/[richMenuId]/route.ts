import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { decrypt } from '@/lib/utils/crypto'
import { lineBotRequestJson } from '@/lib/line/line-bot-api'

type Params = { params: Promise<{ serviceId: string; richMenuId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, richMenuId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_rich_menus')
    .select('*')
    .eq('id', richMenuId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, richMenuId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('line_messaging_rich_menus')
    .select('line_rich_menu_id')
    .eq('id', richMenuId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!row?.line_rich_menu_id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: cred } = await admin
    .from('line_messaging_service_credentials')
    .select('channel_access_token_enc')
    .eq('service_id', serviceId)
    .maybeSingle()

  if (cred?.channel_access_token_enc) {
    try {
      const token = decrypt(cred.channel_access_token_enc)
      await lineBotRequestJson(
        'DELETE',
        `/richmenu/${encodeURIComponent(row.line_rich_menu_id)}`,
        token,
      )
    } catch {
      /* continue DB delete */
    }
  }

  const { error } = await admin.from('line_messaging_rich_menus').delete().eq('id', richMenuId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
