export type FormQuestionRow = {
  id: string
  question_order: number
  label: string
  question_type: 'text' | 'textarea' | 'select' | 'number'
  required: boolean
  options: unknown
}

export function validateFormAnswers(
  questions: FormQuestionRow[],
  answers: Record<string, string>,
): { ok: true } | { ok: false; error: string; field?: string } {
  for (const q of questions) {
    const raw = answers[q.id]
    const val = raw === undefined || raw === null ? '' : String(raw).trim()

    if (q.required && !val) {
      return { ok: false, error: 'required_field_missing', field: q.id }
    }

    if (!val) continue

    if (q.question_type === 'number' && Number.isNaN(Number(val))) {
      return { ok: false, error: 'invalid_number', field: q.id }
    }

    if (q.question_type === 'select') {
      const opts = Array.isArray(q.options) ? (q.options as string[]) : []
      if (!opts.includes(val)) {
        return { ok: false, error: 'invalid_select', field: q.id }
      }
    }
  }

  return { ok: true }
}
