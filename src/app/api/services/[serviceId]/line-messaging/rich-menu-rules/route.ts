import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

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
    .from('line_messaging_rich_menu_rules')
    .select('*')
    .eq('service_id', serviceId)
    .order('priority', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  priority: z.number().int().min(0).max(1_000_000).optional().default(100),
  rich_menu_id: z.string().uuid(),
  segment_id: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional().default(true),
})

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
  const { data: menu } = await admin
    .from('line_messaging_rich_menus')
    .select('id')
    .eq('id', parsed.data.rich_menu_id)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (!menu) return NextResponse.json({ error: 'rich_menu_not_found' }, { status: 404 })

  if (parsed.data.segment_id) {
    const { data: seg } = await admin
      .from('line_messaging_segments')
      .select('id')
      .eq('id', parsed.data.segment_id)
      .eq('service_id', serviceId)
      .maybeSingle()
    if (!seg) return NextResponse.json({ error: 'segment_not_found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('line_messaging_rich_menu_rules')
    .insert({
      service_id: serviceId,
      priority: parsed.data.priority,
      rich_menu_id: parsed.data.rich_menu_id,
      segment_id: parsed.data.segment_id ?? null,
      enabled: parsed.data.enabled,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}
