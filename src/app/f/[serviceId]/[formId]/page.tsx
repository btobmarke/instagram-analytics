'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

type Question = {
  id: string
  question_order: number
  label: string
  question_type: 'text' | 'textarea' | 'select' | 'number'
  required: boolean
  options: string[] | null
}

type FormDef = {
  id: string
  title: string
  description: string | null
  questions: Question[]
}

export default function PublicLineFormPage() {
  const route = useParams<{ serviceId: string; formId: string }>()
  const searchParams = useSearchParams()
  const token = searchParams.get('t')?.trim() ?? ''

  const serviceId = typeof route.serviceId === 'string' ? route.serviceId : ''
  const formId = typeof route.formId === 'string' ? route.formId : ''

  const [form, setForm] = useState<FormDef | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const load = useCallback(async () => {
    if (!serviceId || !formId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/line-forms/${serviceId}/${formId}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error === 'disabled' ? 'このフォームは現在ご利用いただけません。' : 'フォームを読み込めませんでした。')
        setForm(null)
        return
      }
      setForm(json.data as FormDef)
    } catch {
      setError('通信エラーが発生しました。')
    } finally {
      setLoading(false)
    }
  }, [serviceId, formId])

  useEffect(() => {
    if (serviceId && formId) void load()
  }, [serviceId, formId, load])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!serviceId || !formId || !token) {
      setError('URL にトークン（t=）が含まれていません。')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/line-forms/${serviceId}/${formId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answers }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          json.error === 'already_submitted'
            ? 'すでに送信済みです。'
            : json.error === 'session_expired'
              ? 'リンクの有効期限が切れています。'
              : json.error === 'session_not_found'
                ? 'セッションが無効です。'
                : '送信に失敗しました。'
        setError(msg)
        return
      }
      setDone(true)
    } catch {
      setError('通信エラーが発生しました。')
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <p className="text-gray-700">このフォームにはアクセス用のトークンが必要です。</p>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <p className="text-gray-600">読み込み中…</p>
      </main>
    )
  }

  if (done) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <h1 className="text-xl font-semibold text-gray-900">送信しました</h1>
        <p className="mt-2 text-gray-700">ありがとうございました。</p>
      </main>
    )
  }

  if (!form) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <p className="text-red-700">{error ?? 'フォームを表示できません。'}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl font-semibold text-gray-900">{form.title}</h1>
      {form.description ? <p className="mt-2 whitespace-pre-wrap text-gray-700">{form.description}</p> : null}

      <form className="mt-8 space-y-6" onSubmit={onSubmit}>
        {form.questions.map((q) => (
          <div key={q.id}>
            <label className="block text-sm font-medium text-gray-800">
              {q.label}
              {q.required ? <span className="text-red-600"> *</span> : null}
            </label>
            {q.question_type === 'textarea' ? (
              <textarea
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                required={q.required}
                rows={4}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            ) : q.question_type === 'select' ? (
              <select
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                required={q.required}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              >
                <option value="">{q.required ? '選択してください' : '（任意）'}</option>
                {(q.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={q.question_type === 'number' ? 'number' : 'text'}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                required={q.required}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            )}
          </div>
        ))}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-gray-900 px-4 py-3 text-white disabled:opacity-50"
        >
          {submitting ? '送信中…' : '送信'}
        </button>
      </form>
    </main>
  )
}
