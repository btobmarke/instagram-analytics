import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { SegmentDefinitionSchema } from '@/lib/line/segment-definition'

type Params = { params: Promise<{ serviceId: string; segmentId: string }> }

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  definition: z.unknown().optional(),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const { serviceId, segmentId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim()
  if (parsed.data.definition !== undefined) {
    const defParsed = SegmentDefinitionSchema.safeParse(parsed.data.definition ?? {})
    if (!defParsed.success) {
      return NextResponse.json(
        { error: 'invalid_segment_definition', details: defParsed.error.flatten() },
        { status: 422 },
      )
    }
    patch.definition = defParsed.data
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_segments')
    .update(patch)
    .eq('id', segmentId)
    .eq('service_id', serviceId)
    .select('id, name, definition, created_at, updated_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, segmentId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: deleted, error } = await admin
    .from('line_messaging_segments')
    .delete()
    .eq('id', segmentId)
    .eq('service_id', serviceId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
