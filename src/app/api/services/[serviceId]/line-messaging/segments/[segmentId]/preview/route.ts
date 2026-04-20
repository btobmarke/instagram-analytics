import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { SegmentDefinitionSchema } from '@/lib/line/segment-definition'
import { resolveSegmentLineUserIds } from '@/lib/line/evaluate-segment'

type Params = { params: Promise<{ serviceId: string; segmentId: string }> }

/**
 * GET /api/services/[serviceId]/line-messaging/segments/[segmentId]/preview
 * 現在の定義で一致する人数と、先頭の line_user_id サンプル（最大 20）
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, segmentId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data: seg, error } = await admin
    .from('line_messaging_segments')
    .select('id, definition')
    .eq('id', segmentId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!seg) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const defParsed = SegmentDefinitionSchema.safeParse(seg.definition ?? {})
  if (!defParsed.success) {
    return NextResponse.json(
      { error: 'invalid_stored_definition', details: defParsed.error.flatten() },
      { status: 500 },
    )
  }

  const resolved = await resolveSegmentLineUserIds(admin, serviceId, defParsed.data)
  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 400 })
  }

  const sample = resolved.line_user_ids.slice(0, 20)
  return NextResponse.json({
    success: true,
    data: {
      count: resolved.line_user_ids.length,
      sample_line_user_ids: sample,
    },
  })
}
