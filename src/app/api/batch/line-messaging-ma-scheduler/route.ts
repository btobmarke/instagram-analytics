import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { decrypt } from '@/lib/utils/crypto'
import { lineMessagingPush } from '@/lib/line/messaging-api'

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * POST /api/batch/line-messaging-ma-scheduler
 * リマインダ送信 + シナリオの次ステップ送信
 */
export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('line-messaging-ma-scheduler', request)
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'バッチ認証に失敗しました' } },
      { status: 401 },
    )
  }

  const supabase = createServiceRoleClient()
  const nowIso = new Date().toISOString()

  const { data: creds } = await supabase
    .from('line_messaging_service_credentials')
    .select('service_id, channel_access_token_enc')

  const tokenByService = new Map<string, string>()
  for (const c of creds ?? []) {
    try {
      tokenByService.set(c.service_id, decrypt(c.channel_access_token_enc))
    } catch {
      /* skip */
    }
  }

  let reminders_sent = 0
  let scenarios_advanced = 0

  const { data: dueReminders, error: rErr } = await supabase
    .from('line_messaging_reminders')
    .select('id, service_id, contact_id, message_text')
    .eq('status', 'scheduled')
    .lte('run_at', nowIso)
    .order('run_at', { ascending: true })
    .limit(25)

  if (rErr) {
    return NextResponse.json({ success: false, error: rErr.message }, { status: 500 })
  }

  for (const rem of dueReminders ?? []) {
    const token = tokenByService.get(rem.service_id)
    const { data: contact } = await supabase
      .from('line_messaging_contacts')
      .select('line_user_id')
      .eq('id', rem.contact_id)
      .maybeSingle()

    if (!token || !contact?.line_user_id) {
      await supabase
        .from('line_messaging_reminders')
        .update({
          status: 'failed',
          last_error: !token ? 'no_channel_token' : 'no_line_user_id',
          updated_at: new Date().toISOString(),
        })
        .eq('id', rem.id)
      continue
    }

    const push = await lineMessagingPush(token, contact.line_user_id, [
      { type: 'text', text: rem.message_text },
    ])
    if (!push.ok) {
      await supabase
        .from('line_messaging_reminders')
        .update({
          status: 'failed',
          last_error: `${push.status}: ${push.message}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rem.id)
      continue
    }

    await supabase
      .from('line_messaging_reminders')
      .update({
        status: 'sent',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rem.id)

    await supabase.from('line_messaging_events').insert({
      service_id: rem.service_id,
      contact_id: rem.contact_id,
      line_user_id: contact.line_user_id,
      trigger_type: 'reminder.sent',
      payload: { reminder_id: rem.id },
      occurred_at: new Date().toISOString(),
    })
    reminders_sent++
  }

  const { data: enrollments, error: eErr } = await supabase
    .from('line_messaging_scenario_enrollments')
    .select('id, service_id, contact_id, scenario_id, current_step_order, status')
    .eq('status', 'active')
    .lte('next_run_at', nowIso)
    .order('next_run_at', { ascending: true })
    .limit(25)

  if (eErr) {
    return NextResponse.json({ success: false, error: eErr.message }, { status: 500 })
  }

  for (const en of enrollments ?? []) {
    const token = tokenByService.get(en.service_id)
    const { data: contact } = await supabase
      .from('line_messaging_contacts')
      .select('line_user_id')
      .eq('id', en.contact_id)
      .maybeSingle()

    if (!token || !contact?.line_user_id) {
      await supabase
        .from('line_messaging_scenario_enrollments')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', en.id)
      continue
    }

    const { data: step } = await supabase
      .from('line_messaging_scenario_steps')
      .select('step_order, message_text, delay_before_seconds')
      .eq('scenario_id', en.scenario_id)
      .eq('step_order', en.current_step_order)
      .maybeSingle()

    if (!step) {
      await supabase
        .from('line_messaging_scenario_enrollments')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', en.id)
      continue
    }

    const push = await lineMessagingPush(token, contact.line_user_id, [
      { type: 'text', text: step.message_text },
    ])
    if (!push.ok) {
      await supabase.from('line_messaging_events').insert({
        service_id: en.service_id,
        contact_id: en.contact_id,
        line_user_id: contact.line_user_id,
        trigger_type: 'scenario.push_error',
        payload: { enrollment_id: en.id, error: push.message, status: push.status },
        occurred_at: new Date().toISOString(),
      })
      continue
    }

    await supabase.from('line_messaging_events').insert({
      service_id: en.service_id,
      contact_id: en.contact_id,
      line_user_id: contact.line_user_id,
      trigger_type: 'scenario.step_sent',
      payload: { enrollment_id: en.id, step_order: step.step_order },
      occurred_at: new Date().toISOString(),
    })

    const { data: nextStep } = await supabase
      .from('line_messaging_scenario_steps')
      .select('step_order, delay_before_seconds')
      .eq('scenario_id', en.scenario_id)
      .gt('step_order', step.step_order)
      .order('step_order', { ascending: true })
      .limit(1)
      .maybeSingle()

    const ts = new Date().toISOString()
    if (!nextStep) {
      await supabase
        .from('line_messaging_scenario_enrollments')
        .update({ status: 'completed', updated_at: ts })
        .eq('id', en.id)
    } else {
      const delayMs = Math.max(0, (nextStep.delay_before_seconds ?? 0) * 1000)
      const nextRun = new Date(Date.now() + delayMs).toISOString()
      await supabase
        .from('line_messaging_scenario_enrollments')
        .update({
          current_step_order: nextStep.step_order,
          next_run_at: nextRun,
          updated_at: ts,
        })
        .eq('id', en.id)
    }
    scenarios_advanced++
  }

  return NextResponse.json({
    success: true,
    data: { reminders_sent, scenarios_advanced, at: nowIso },
  })
}
