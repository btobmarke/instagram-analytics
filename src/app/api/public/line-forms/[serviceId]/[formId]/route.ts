import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { submitLineFormResponse } from '@/lib/line/submit-line-form-response'

type Params = { params: Promise<{ serviceId: string; formId: string }> }

/**
 * GET /api/public/line-forms/[serviceId]/[formId]
 * 公開フォーム定義（認証不要）
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, formId } = await params
  const admin = createSupabaseAdminClient()

  const { data: service, error: svcErr } = await admin
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()

  if (svcErr || !service || service.service_type !== 'line') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: form, error: fErr } = await admin
    .from('line_messaging_forms')
    .select('id, title, description, slug, enabled')
    .eq('id', formId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (fErr || !form) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!form.enabled) return NextResponse.json({ error: 'disabled' }, { status: 403 })

  const { data: questions, error: qErr } = await admin
    .from('line_messaging_form_questions')
    .select('id, question_order, label, question_type, required, options')
    .eq('form_id', formId)
    .order('question_order', { ascending: true })

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: { ...form, questions: questions ?? [] },
  })
}

/**
 * POST /api/public/line-forms/[serviceId]/[formId]
 * body: { token, answers: { [questionId]: string } }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId, formId } = await params
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token : ''
  const answers =
    body?.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
      ? (body.answers as Record<string, string>)
      : {}

  const admin = createSupabaseAdminClient()
  const result = await submitLineFormResponse(admin, {
    serviceId,
    formId,
    publicToken: token,
    answers,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ success: true })
}
