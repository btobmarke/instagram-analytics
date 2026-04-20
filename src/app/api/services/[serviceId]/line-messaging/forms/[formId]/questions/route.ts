import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; formId: string }> }

const QuestionSchema = z.object({
  question_order: z.number().int().min(0).max(999),
  label: z.string().min(1).max(500),
  question_type: z.enum(['text', 'textarea', 'select', 'number']),
  required: z.boolean().optional().default(false),
  options: z.array(z.string()).optional(),
})

const PutSchema = z.object({
  questions: z.array(QuestionSchema).min(1),
})

/**
 * PUT .../forms/[formId]/questions — 設問を全置換
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { serviceId, formId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const orders = parsed.data.questions.map((q) => q.question_order)
  if (new Set(orders).size !== orders.length) {
    return NextResponse.json({ error: 'duplicate_question_order' }, { status: 422 })
  }

  for (const q of parsed.data.questions) {
    if (q.question_type === 'select') {
      const opts = q.options ?? []
      if (opts.length === 0) {
        return NextResponse.json(
          { error: 'select_requires_options', order: q.question_order },
          { status: 422 },
        )
      }
    }
  }

  const admin = createSupabaseAdminClient()
  const { data: form, error: fErr } = await admin
    .from('line_messaging_forms')
    .select('id')
    .eq('id', formId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (fErr || !form) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error: delErr } = await admin.from('line_messaging_form_questions').delete().eq('form_id', formId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  const rows = parsed.data.questions.map((q) => ({
    form_id: formId,
    question_order: q.question_order,
    label: q.label.trim(),
    question_type: q.question_type,
    required: q.required ?? false,
    options: q.question_type === 'select' ? (q.options ?? []) : null,
  }))

  const { error: insErr } = await admin.from('line_messaging_form_questions').insert(rows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  const { data: questions } = await admin
    .from('line_messaging_form_questions')
    .select('id, question_order, label, question_type, required, options')
    .eq('form_id', formId)
    .order('question_order', { ascending: true })

  return NextResponse.json({ success: true, data: questions ?? [] })
}
