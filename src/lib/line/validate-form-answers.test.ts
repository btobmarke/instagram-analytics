import { describe, expect, it } from 'vitest'
import { validateFormAnswers } from './validate-form-answers'

describe('validateFormAnswers', () => {
  const qs = [
    {
      id: 'a',
      question_order: 0,
      label: 'Name',
      question_type: 'text' as const,
      required: true,
      options: null,
    },
  ]

  it('requires value when required', () => {
    const r = validateFormAnswers(qs, {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('required_field_missing')
  })

  it('accepts valid', () => {
    const r = validateFormAnswers(qs, { a: 'x' })
    expect(r.ok).toBe(true)
  })
})
