import type { SupabaseClient } from '@supabase/supabase-js'
import type { FormQuestionRow } from '@/lib/line/validate-form-answers'
import { validateFormAnswers } from '@/lib/line/validate-form-answers'
import { runFormPostSubmitActions } from '@/lib/line/run-form-post-submit-actions'
import { logMessagingEvent } from '@/lib/line/log-messaging-event'

export async function submitLineFormResponse(
  admin: SupabaseClient,
  opts: {
    serviceId: string
    formId: string
    publicToken: string
    answers: Record<string, string>
  },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = opts.publicToken.trim()
  if (!token) return { ok: false, status: 400, error: 'token_required' }

  const { data: session, error: sErr } = await admin
    .from('line_messaging_form_sessions')
    .select('id, form_id, line_user_id, expires_at, utm')
    .eq('public_token', token)
    .maybeSingle()

  if (sErr || !session || session.form_id !== opts.formId) {
    return { ok: false, status: 404, error: 'session_not_found' }
  }

  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 410, error: 'session_expired' }
  }

  const { data: form, error: fErr } = await admin
    .from('line_messaging_forms')
    .select('id, service_id, enabled, post_submit_actions')
    .eq('id', opts.formId)
    .eq('service_id', opts.serviceId)
    .maybeSingle()

  if (fErr || !form) return { ok: false, status: 404, error: 'form_not_found' }
  if (!form.enabled) return { ok: false, status: 403, error: 'form_disabled' }

  const { data: existing } = await admin
    .from('line_messaging_form_responses')
    .select('id')
    .eq('session_id', session.id)
    .maybeSingle()

  if (existing) {
    return { ok: false, status: 409, error: 'already_submitted' }
  }

  const { data: questions, error: qErr } = await admin
    .from('line_messaging_form_questions')
    .select('id, question_order, label, question_type, required, options')
    .eq('form_id', opts.formId)
    .order('question_order', { ascending: true })

  if (qErr) return { ok: false, status: 500, error: qErr.message }
  const qList = (questions ?? []) as FormQuestionRow[]
  if (qList.length === 0) return { ok: false, status: 400, error: 'form_has_no_questions' }

  const validation = validateFormAnswers(qList, opts.answers)
  if (!validation.ok) {
    return { ok: false, status: 422, error: validation.error }
  }

  let contactId: string | null = null
  let lineUserId: string | null = session.line_user_id?.trim() || null

  if (lineUserId) {
    const { data: contact } = await admin
      .from('line_messaging_contacts')
      .select('id')
      .eq('service_id', opts.serviceId)
      .eq('line_user_id', lineUserId)
      .maybeSingle()
    contactId = contact?.id ?? null
  }

  const attribution =
    typeof session.utm === 'object' && session.utm !== null && !Array.isArray(session.utm)
      ? (session.utm as Record<string, unknown>)
      : {}

  const { error: insErr } = await admin.from('line_messaging_form_responses').insert({
    form_id: opts.formId,
    session_id: session.id,
    contact_id: contactId,
    line_user_id: lineUserId,
    answers: opts.answers,
    attribution,
  })

  if (insErr) return { ok: false, status: 500, error: insErr.message }

  await logMessagingEvent(admin, {
    service_id: opts.serviceId,
    contact_id: contactId,
    line_user_id: lineUserId,
    trigger_type: 'form.submitted',
    payload: { form_id: opts.formId, session_id: session.id },
  })

  const run = await runFormPostSubmitActions(
    admin,
    opts.serviceId,
    contactId,
    form.post_submit_actions,
  )
  if (!run.ok) {
    await logMessagingEvent(admin, {
      service_id: opts.serviceId,
      contact_id: contactId,
      line_user_id: lineUserId,
      trigger_type: 'form.post_submit_action_error',
      payload: { form_id: opts.formId, error: run.error },
    })
  }

  return { ok: true }
}
