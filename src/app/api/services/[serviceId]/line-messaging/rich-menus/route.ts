import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { decrypt } from '@/lib/utils/crypto'
import { lineBotRequestJson } from '@/lib/line/line-bot-api'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_rich_menus')
    .select('*')
    .eq('service_id', serviceId)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  name: z.string().min(1).max(200),
  size: z.object({ width: z.number(), height: z.number() }).optional(),
  chat_bar_text: z.string().min(1).max(14).default('メニュー'),
  selected: z.boolean().optional().default(false),
  areas: z.array(z.unknown()).min(1),
  enabled: z.boolean().optional().default(true),
})

/**
 * POST — DB に保存し、LINE API で richMenu を作成して line_rich_menu_id を保存（画像は別 API でアップロード）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

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

  const size = parsed.data.size ?? { width: 2500, height: 1686 }
  const lineBody = {
    size: { width: size.width, height: size.height },
    selected: parsed.data.selected,
    name: parsed.data.name.trim().slice(0, 300),
    chatBarText: parsed.data.chat_bar_text,
    areas: parsed.data.areas,
  }

  const lineRes = await lineBotRequestJson('POST', '/richmenu', token, lineBody)
  if (!lineRes.ok) {
    return NextResponse.json(
      { error: 'line_rich_menu_create_failed', message: lineRes.message, status: lineRes.status },
      { status: 502 },
    )
  }

  const richMenuId =
    lineRes.body && typeof lineRes.body === 'object' && lineRes.body !== null && 'richMenuId' in lineRes.body
      ? String((lineRes.body as { richMenuId: string }).richMenuId)
      : null

  if (!richMenuId) {
    return NextResponse.json({ error: 'line_response_missing_rich_menu_id' }, { status: 502 })
  }

  const { data: row, error: insErr } = await admin
    .from('line_messaging_rich_menus')
    .insert({
      service_id: serviceId,
      name: parsed.data.name.trim(),
      line_rich_menu_id: richMenuId,
      size,
      chat_bar_text: parsed.data.chat_bar_text,
      selected: parsed.data.selected,
      areas: parsed.data.areas,
      enabled: parsed.data.enabled,
    })
    .select('*')
    .single()

  if (insErr) {
    await lineBotRequestJson('DELETE', `/richmenu/${encodeURIComponent(richMenuId)}`, token)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: row })
}
