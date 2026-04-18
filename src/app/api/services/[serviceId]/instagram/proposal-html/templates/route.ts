export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import { listHtmlTemplates } from '@/lib/instagram/proposal-html/templates'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const resolved = await resolveInstagramAccountIdForService(supabase, serviceId)
  if ('error' in resolved) {
    return NextResponse.json({ success: false, error: resolved.error }, { status: resolved.status })
  }

  const templates = listHtmlTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    pages: [
      { kind: 'cover' as const, wireId: t.rules.cover.wireId, parts: t.rules.cover.parts },
      { kind: 'kpi' as const, wireId: t.rules.kpi.wireId, parts: t.rules.kpi.parts },
      { kind: 'section' as const, wireId: t.rules.section.wireId, parts: t.rules.section.parts },
    ],
  }))

  return NextResponse.json({ success: true, data: { templates } })
}
