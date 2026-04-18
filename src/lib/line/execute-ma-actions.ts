import type { SupabaseClient } from '@supabase/supabase-js'
import type { MaAction } from '@/lib/line/ma-action-types'

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
    }
  }

  return { ok: true }
}
