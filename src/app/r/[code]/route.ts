import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ code: string }> }

/**
 * GET /r/[code] — 短縮 URL リダイレクト + クリック計測（G1）
 * Query: uid（任意 line_user_id）, utm_source, utm_medium, utm_campaign, utm_term, utm_content
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { code } = await params
  const trimmed = code.trim()
  if (!trimmed) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const admin = createSupabaseAdminClient()
  const { data: link, error } = await admin
    .from('line_messaging_short_links')
    .select('id, service_id, target_url')
    .eq('code', trimmed)
    .maybeSingle()

  if (error || !link) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const sp = req.nextUrl.searchParams
  const uid = sp.get('uid')?.trim() || null

  let contactId: string | null = null
  if (uid) {
    const { data: c } = await admin
      .from('line_messaging_contacts')
      .select('id')
      .eq('service_id', link.service_id)
      .eq('line_user_id', uid)
      .maybeSingle()
    contactId = c?.id ?? null
  }

  const utm: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = sp.get(k)?.trim()
    if (v) utm[k] = v.slice(0, 500)
  }

  const ua = req.headers.get('user-agent')?.slice(0, 2000) ?? null

  await admin.from('line_messaging_link_clicks').insert({
    service_id: link.service_id,
    short_link_id: link.id,
    contact_id: contactId,
    line_user_id: uid,
    utm,
    user_agent: ua,
  })

  return NextResponse.redirect(link.target_url, 302)
}
