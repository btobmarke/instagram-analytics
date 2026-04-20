import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeExplicitUserIds, seedBroadcastRecipients } from '@/lib/line/process-broadcast-job-chunk'
import { SegmentDefinitionSchema } from '@/lib/line/segment-definition'
import { resolveSegmentLineUserIds } from '@/lib/line/evaluate-segment'

export type CreateBroadcastJobInput = {
  template_id: string
  name?: string | null
  recipient_source: 'all_followed' | 'explicit' | 'segment'
  explicit_line_user_ids?: string[]
  segment_id?: string | null
  scheduled_at?: string
}

export async function createLineBroadcastJob(
  admin: SupabaseClient,
  serviceId: string,
  input: CreateBroadcastJobInput,
): Promise<
  | {
      ok: true
      data: {
        id: string
        template_id: string
        name: string | null
        snapshot_body_text: string
        recipient_source: string
        segment_id: string | null
        scheduled_at: string
        status: string
        created_at: string
      }
    }
  | { ok: false; error: string; status?: number }
> {
  const { data: template, error: tplErr } = await admin
    .from('line_messaging_templates')
    .select('id, body_text')
    .eq('id', input.template_id)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (tplErr || !template) {
    return { ok: false, error: 'template_not_found', status: 404 }
  }

  let scheduledAt = new Date().toISOString()
  if (input.scheduled_at !== undefined && input.scheduled_at !== '') {
    const ms = Date.parse(input.scheduled_at)
    if (Number.isNaN(ms)) {
      return { ok: false, error: 'invalid_scheduled_at', status: 422 }
    }
    scheduledAt = new Date(ms).toISOString()
  }

  let lineUserIds: string[] = []
  let segmentId: string | null = null

  if (input.recipient_source === 'explicit') {
    lineUserIds = normalizeExplicitUserIds(input.explicit_line_user_ids ?? [])
  } else if (input.recipient_source === 'segment') {
    if (!input.segment_id) {
      return { ok: false, error: 'segment_id required', status: 400 }
    }
    segmentId = input.segment_id
    const { data: seg, error: sErr } = await admin
      .from('line_messaging_segments')
      .select('id, definition')
      .eq('id', segmentId)
      .eq('service_id', serviceId)
      .maybeSingle()

    if (sErr || !seg) {
      return { ok: false, error: 'segment_not_found', status: 404 }
    }

    const defParsed = SegmentDefinitionSchema.safeParse(seg.definition ?? {})
    if (!defParsed.success) {
      return { ok: false, error: 'invalid_segment_definition', status: 500 }
    }

    const resolved = await resolveSegmentLineUserIds(admin, serviceId, defParsed.data)
    if (resolved.error) {
      return { ok: false, error: resolved.error, status: 400 }
    }
    lineUserIds = resolved.line_user_ids
    if (lineUserIds.length === 0) {
      return { ok: false, error: 'segment_empty', status: 400 }
    }
  } else {
    const { data: contacts, error: cErr } = await admin
      .from('line_messaging_contacts')
      .select('line_user_id')
      .eq('service_id', serviceId)
      .eq('is_followed', true)

    if (cErr) return { ok: false, error: cErr.message, status: 500 }
    lineUserIds = (contacts ?? []).map((r) => r.line_user_id).filter(Boolean)
  }

  if (lineUserIds.length === 0) {
    return { ok: false, error: 'no_recipients', status: 400 }
  }

  const { data: job, error: jobErr } = await admin
    .from('line_messaging_broadcast_jobs')
    .insert({
      service_id: serviceId,
      template_id: template.id,
      name: input.name?.trim() ?? null,
      snapshot_body_text: template.body_text,
      recipient_source: input.recipient_source,
      segment_id: segmentId,
      explicit_line_user_ids: input.recipient_source === 'explicit' ? lineUserIds : null,
      scheduled_at: scheduledAt,
      status: 'scheduled',
    })
    .select(
      'id, template_id, name, snapshot_body_text, recipient_source, segment_id, scheduled_at, status, created_at',
    )
    .single()

  if (jobErr || !job) {
    return { ok: false, error: jobErr?.message ?? 'insert failed', status: 500 }
  }

  const seed = await seedBroadcastRecipients(admin, job.id, lineUserIds)
  if (seed.error) {
    await admin.from('line_messaging_broadcast_jobs').delete().eq('id', job.id)
    return { ok: false, error: seed.error, status: 500 }
  }

  return { ok: true, data: job }
}
