import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { decrypt } from '@/lib/utils/crypto'
import { lineBotLinkRichMenuToUser } from '@/lib/line/line-bot-api'

type Params = { params: Promise<{ serviceId: string; richMenuId: string }> }

const BodySchema = z.object({
  line_user_id: z.string().min(1).max(128),
})

export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId, richMenuId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: menu } = await admin
    .from('line_messaging_rich_menus')
    .select('line_rich_menu_id, enabled')
    .eq('id', richMenuId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!menu?.line_rich_menu_id || !menu.enabled) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

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

  const res = await lineBotLinkRichMenuToUser(token, parsed.data.line_user_id.trim(), menu.line_rich_menu_id)
  if (!res.ok) {
    return NextResponse.json(
      { error: 'link_failed', message: res.message, status: res.status },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true })
}
