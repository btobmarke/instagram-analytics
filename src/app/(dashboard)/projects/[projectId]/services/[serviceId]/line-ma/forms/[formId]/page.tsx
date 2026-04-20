'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

type QType = 'text' | 'textarea' | 'select' | 'number'

interface QuestionRow {
  id?: string
  question_order: number
  label: string
  question_type: QType
  required: boolean
  options: string[]
}

interface FormDetail {
  id: string
  title: string
  description: string | null
  slug: string
  enabled: boolean
  updated_at?: string
  questions: QuestionRow[]
}

interface ResponseRow {
  id: string
  line_user_id: string | null
  answers: Record<string, unknown>
  submitted_at: string
}

export default function LineMaFormDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string; formId: string }>
}) {
  const { projectId, serviceId, formId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const formUrl = `/api/services/${serviceId}/line-messaging/forms/${formId}`
  const { data: formResp, mutate, isLoading } = useSWR(
    service?.service_type === 'line' ? formUrl : null,
    fetcher,
  )

  const form: FormDetail | undefined = formResp?.data

  const { data: respResp } = useSWR(
    service?.service_type === 'line'
      ? `/api/services/${serviceId}/line-messaging/forms/${formId}/responses`
      : null,
    fetcher,
  )
  const responses: ResponseRow[] = respResp?.data ?? []

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [savingMeta, setSavingMeta] = useState(false)

  const [questions, setQuestions] = useState<QuestionRow[]>([])
  const [savingQ, setSavingQ] = useState(false)

  const [sessLineUser, setSessLineUser] = useState('')
  const [sessBusy, setSessBusy] = useState(false)
  const [lastSessionUrl, setLastSessionUrl] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(typeof window !== 'undefined' ? window.location.origin : '')
  }, [])

  const basePublicPath = origin ? `${origin}/f/${serviceId}/${formId}` : ''

  useEffect(() => {
    if (!form) return
    setTitle(form.title)
    setSlug(form.slug)
    setDescription(form.description ?? '')
    setEnabled(form.enabled)
    const qs = (form.questions ?? []).map((q) => ({
      question_order: q.question_order,
      label: q.label,
      question_type: q.question_type as QType,
      required: q.required ?? false,
      options: Array.isArray(q.options) ? q.options : [],
    }))
    setQuestions(
      qs.length
        ? qs
        : [{ question_order: 0, label: '', question_type: 'text', required: false, options: [] }],
    )
  }, [form?.id, form?.slug, form?.title, form?.enabled, form?.description, form?.updated_at, form?.questions])

  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingMeta(true)
    const res = await fetch(formUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        enabled,
      }),
    })
    setSavingMeta(false)
    if (res.ok) mutate()
    else {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '保存に失敗しました')
    }
  }

  const saveQuestions = async () => {
    setSavingQ(true)
    const payload = {
      questions: questions
        .filter((q) => q.label.trim())
        .map((q) => ({
          question_order: q.question_order,
          label: q.label.trim(),
          question_type: q.question_type,
          required: q.required,
          options: q.question_type === 'select' ? q.options.filter((o) => o.trim()) : undefined,
        })),
    }
    if (!payload.questions.length) {
      alert('設問を1つ以上入力してください')
      setSavingQ(false)
      return
    }
    const res = await fetch(`${formUrl}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSavingQ(false)
    if (res.ok) mutate()
    else {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '設問の保存に失敗しました')
    }
  }

  const createSession = async () => {
    setSessBusy(true)
    setLastSessionUrl(null)
    const res = await fetch(`${formUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: sessLineUser.trim() || undefined,
        ttl_days: 30,
      }),
    })
    const json = await res.json()
    setSessBusy(false)
    if (json.success && json.data?.public_url) {
      setLastSessionUrl(json.data.public_url as string)
    } else {
      alert(json.error ?? 'セッション作成に失敗しました')
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      alert('コピーしました')
    } catch {
      alert('コピーに失敗しました')
    }
  }

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  if (!isLoading && formResp && (formResp as { error?: string }).error === 'not_found') {
    return (
      <div className="p-6 w-full max-w-none">
        <p className="text-sm text-gray-600">フォームが見つかりません。</p>
        <Link href={`/projects/${projectId}/services/${serviceId}/line-ma/forms`} className="text-green-600 text-sm mt-2 inline-block">
          一覧へ
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 w-full max-w-none">
      <LineMaBreadcrumb
        projectId={projectId}
        serviceId={serviceId}
        projectName={service?.project.project_name ?? ''}
        serviceName={service?.service_name ?? ''}
        extra="フォーム編集"
      />
      <div className="mb-4">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/line-ma/forms`}
          className="text-xs text-green-600 hover:underline"
        >
          ← 一覧
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          📋
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{form?.title ?? 'フォーム'}</h1>
          <p className="text-sm text-gray-400 font-mono">{formId}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : !form ? (
        <p className="text-sm text-gray-500">読み込めませんでした。</p>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">公開 URL（トークンなし）</h2>
            <p className="text-xs text-gray-500 mb-2">
              回答用セッションを発行すると <code className="font-mono">?t=</code> が付きます。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-xs font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1.5 break-all flex-1">
                {basePublicPath || `（読み込み中）/f/${serviceId}/${formId}`}
              </code>
              <button
                type="button"
                disabled={!basePublicPath}
                onClick={() => copy(basePublicPath)}
                className="text-xs px-3 py-1.5 border border-green-300 rounded-lg text-green-800 disabled:opacity-50"
              >
                コピー
              </button>
            </div>
          </div>

          <form onSubmit={saveMeta} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-3">
            <h2 className="font-bold text-gray-900">基本設定</h2>
            <div>
              <label className="text-xs text-gray-500">タイトル</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">スラッグ</label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">説明</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              有効
            </label>
            <button
              type="submit"
              disabled={savingMeta}
              className="block px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
            >
              {savingMeta ? '保存中...' : '基本設定を保存'}
            </button>
          </form>

          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">設問</h2>
            {questions.map((q, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-3 mb-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="number"
                    value={q.question_order}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, question_order: v } : x)))
                    }}
                    className="w-20 px-2 py-1 text-sm border rounded-lg"
                  />
                  <select
                    value={q.question_type}
                    onChange={(e) => {
                      const v = e.target.value as QType
                      setQuestions((qs) =>
                        qs.map((x, j) =>
                          j === i ? { ...x, question_type: v, options: v === 'select' ? x.options : [] } : x,
                        ),
                      )
                    }}
                    className="px-2 py-1 text-sm border rounded-lg bg-white"
                  >
                    <option value="text">text</option>
                    <option value="textarea">textarea</option>
                    <option value="number">number</option>
                    <option value="select">select</option>
                  </select>
                  <label className="inline-flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => {
                        const c = e.target.checked
                        setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, required: c } : x)))
                      }}
                    />
                    必須
                  </label>
                </div>
                <input
                  value={q.label}
                  onChange={(e) => {
                    const v = e.target.value
                    setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, label: v } : x)))
                  }}
                  placeholder="ラベル"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
                {q.question_type === 'select' && (
                  <textarea
                    value={q.options.join('\n')}
                    onChange={(e) => {
                      const lines = e.target.value.split('\n')
                      setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, options: lines } : x)))
                    }}
                    placeholder="選択肢（1行に1つ）"
                    rows={3}
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg font-mono"
                  />
                )}
                <button
                  type="button"
                  className="text-xs text-red-500"
                  onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                >
                  この設問を削除
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-sm text-green-600 mb-4"
              onClick={() =>
                setQuestions((qs) => [
                  ...qs,
                  {
                    question_order: (qs[qs.length - 1]?.question_order ?? 0) + 1,
                    label: '',
                    question_type: 'text',
                    required: false,
                    options: [],
                  },
                ])
              }
            >
              + 設問を追加
            </button>
            <button
              type="button"
              onClick={saveQuestions}
              disabled={savingQ}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg disabled:opacity-60"
            >
              {savingQ ? '保存中...' : '設問を保存（全置換）'}
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">回答セッション発行</h2>
            <p className="text-xs text-gray-500 mb-3">
              LINE userId を紐づけると回答が既存コンタクトに保存されやすくなります（任意）。
            </p>
            <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
              <input
                value={sessLineUser}
                onChange={(e) => setSessLineUser(e.target.value)}
                placeholder="LINE userId（任意）"
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              />
              <button
                type="button"
                onClick={createSession}
                disabled={sessBusy}
                className="px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg disabled:opacity-60"
              >
                {sessBusy ? '発行中...' : 'セッション発行'}
              </button>
            </div>
            {lastSessionUrl && (
              <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">公開 URL（トークン付き）</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <code className="text-xs font-mono break-all flex-1">{lastSessionUrl}</code>
                  <button
                    type="button"
                    onClick={() => copy(lastSessionUrl)}
                    className="text-xs px-2 py-1 border border-green-300 rounded"
                  >
                    コピー
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">回答一覧</h2>
            {responses.length === 0 ? (
              <p className="text-sm text-gray-400">回答がありません</p>
            ) : (
              <ul className="space-y-3">
                {responses.map((r) => (
                  <li key={r.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                    <p className="text-xs text-gray-400">
                      {new Date(r.submitted_at).toLocaleString('ja-JP')}{' '}
                      {r.line_user_id && (
                        <span className="font-mono text-gray-600"> {r.line_user_id}</span>
                      )}
                    </p>
                    <pre className="text-xs bg-gray-50 rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(r.answers, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
