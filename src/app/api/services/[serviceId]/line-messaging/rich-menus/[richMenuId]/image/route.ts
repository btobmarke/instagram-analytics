import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { decrypt } from '@/lib/utils/crypto'
import { lineDataUploadRichMenuImage } from '@/lib/line/line-bot-api'

type Params = { params: Promise<{ serviceId: string; richMenuId: string }> }

/**
 * POST multipart/form-data: file (image/jpeg | image/png)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId, richMenuId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: menu } = await admin
    .from('line_messaging_rich_menus')
    .select('line_rich_menu_id')
    .eq('id', richMenuId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!menu?.line_rich_menu_id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

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

  const form = await req.formData()
  const file = form.get('file')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 })
  }

  const ct = file.type
  if (ct !== 'image/jpeg' && ct !== 'image/png') {
    return NextResponse.json({ error: 'invalid_content_type', hint: 'image/jpeg or image/png' }, { status: 422 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const res = await lineDataUploadRichMenuImage(
    token,
    menu.line_rich_menu_id,
    buf,
    ct === 'image/png' ? 'image/png' : 'image/jpeg',
  )

  if (!res.ok) {
    return NextResponse.json(
      { error: 'upload_failed', message: res.message, status: res.status },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true })
}
