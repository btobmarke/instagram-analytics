import type { SupabaseClient } from '@supabase/supabase-js'
import type { MaAction } from '@/lib/line/ma-action-types'
import { seedBroadcastRecipients } from '@/lib/line/process-broadcast-job-chunk'

export type ExecuteActionsResult = { ok: true } | { ok: false; error: string }

/**
 * MA アクション v1（タグ付与・属性・シナリオ開始）
 */
export async function executeMaActions(
  admin: SupabaseClient,
  serviceId: string,
  contactId: string,
  actions: MaAction[],
): Promise<ExecuteActionsResult> {
  const now = new Date().toISOString()

  const { data: contactRow } = await admin
    .from('line_messaging_contacts')
    .select('line_user_id')
    .eq('id', contactId)
    .maybeSingle()
  const lineUserIdForBroadcast = contactRow?.line_user_id?.trim() ?? ''

  for (const action of actions) {
    if (action.type === 'add_tag') {
      const { data: tag } = await admin
        .from('line_messaging_tags')
        .select('id')
        .eq('id', action.tag_id)
        .eq('service_id', serviceId)
        .maybeSingle()
      if (!tag) return { ok: false, error: `tag_not_found:${action.tag_id}` }

      const { error } = await admin
        .from('line_messaging_contact_tags')
        .insert({ contact_id: contactId, tag_id: action.tag_id })
      if (error && error.code !== '23505') {
        return { ok: false, error: error.message }
      }
    } else if (action.type === 'set_attribute') {
      const { data: def } = await admin
        .from('line_messaging_attribute_definitions')
        .select('id, value_type, select_options')
        .eq('id', action.definition_id)
        .eq('service_id', serviceId)
        .maybeSingle()
      if (!def) return { ok: false, error: `definition_not_found:${action.definition_id}` }

      if (def.value_type === 'select') {
        const opts = (def.select_options as string[] | null) ?? []
        if (!opts.includes(action.value_text)) {
          return { ok: false, error: 'invalid_select_value' }
        }
      }
      if (def.value_type === 'number' && Number.isNaN(Number(action.value_text.trim()))) {
        return { ok: false, error: 'invalid_number_value' }
      }

      const { error } = await admin.from('line_messaging_contact_attribute_values').upsert(
        {
          contact_id: contactId,
          definition_id: action.definition_id,
          value_text: action.value_text,
          updated_at: now,
        },
        { onConflict: 'contact_id,definition_id' },
      )
      if (error) return { ok: false, error: error.message }
    } else if (action.type === 'start_scenario') {
      const { data: scenario } = await admin
        .from('line_messaging_scenarios')
        .select('id, enabled')
        .eq('id', action.scenario_id)
        .eq('service_id', serviceId)
        .maybeSingle()
      if (!scenario?.enabled) {
        return { ok: false, error: `scenario_not_found_or_disabled:${action.scenario_id}` }
      }

      const { data: firstStep } = await admin
        .from('line_messaging_scenario_steps')
        .select('step_order, delay_before_seconds')
        .eq('scenario_id', action.scenario_id)
        .order('step_order', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!firstStep) return { ok: false, error: 'scenario_has_no_steps' }

      const delayMs = Math.max(0, (firstStep.delay_before_seconds ?? 0) * 1000)
      const nextRun = new Date(Date.now() + delayMs).toISOString()

      const { error } = await admin.from('line_messaging_scenario_enrollments').upsert(
        {
          service_id: serviceId,
          contact_id: contactId,
          scenario_id: action.scenario_id,
          status: 'active',
          current_step_order: firstStep.step_order,
          next_run_at: nextRun,
          updated_at: now,
        },
        { onConflict: 'contact_id,scenario_id' },
      )
      if (error) return { ok: false, error: error.message }
    } else if (action.type === 'enqueue_broadcast') {
      if (!lineUserIdForBroadcast) {
        return { ok: false, error: 'contact_has_no_line_user_id' }
      }
      const { data: template } = await admin
        .from('line_messaging_templates')
        .select('id, body_text')
        .eq('id', action.template_id)
        .eq('service_id', serviceId)
        .maybeSingle()
      if (!template) return { ok: false, error: `template_not_found:${action.template_id}` }

      let scheduledAt = now
      if (action.scheduled_at) {
        const ms = Date.parse(action.scheduled_at)
        if (!Number.isNaN(ms)) scheduledAt = new Date(ms).toISOString()
      }

      const { data: job, error: jobErr } = await admin
        .from('line_messaging_broadcast_jobs')
        .insert({
          service_id: serviceId,
          template_id: template.id,
          name: 'form_auto_broadcast',
          snapshot_body_text: template.body_text,
          recipient_source: 'explicit',
          explicit_line_user_ids: [lineUserIdForBroadcast],
          scheduled_at: scheduledAt,
          status: 'scheduled',
        })
        .select('id')
        .single()

      if (jobErr || !job) return { ok: false, error: jobErr?.message ?? 'broadcast_insert_failed' }

      const seed = await seedBroadcastRecipients(admin, job.id, [lineUserIdForBroadcast])
      if (seed.error) {
        await admin.from('line_messaging_broadcast_jobs').delete().eq('id', job.id)
        return { ok: false, error: seed.error }
      }
    }
  }

  return { ok: true }
}
