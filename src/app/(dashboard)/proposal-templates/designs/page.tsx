'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type SlideLayout = { id: string; name: string; page_kind: string; tags: string[] }

export default function ProposalDesignsPage() {
  const [layouts, setLayouts] = useState<SlideLayout[]>([])
  const [designs, setDesigns] = useState<{ id: string; name: string; tags: string[] }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [remarks, setRemarks] = useState('')
  const [orderedSlideIds, setOrderedSlideIds] = useState<string[]>([])
  const [pickId, setPickId] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sl, dt] = await Promise.all([
        fetch('/api/proposal-templates/slide-layouts'),
        fetch('/api/proposal-templates/design-templates'),
      ])
      const [jl, jd] = await Promise.all([sl.json(), dt.json()])
      if (jl.success) {
        setLayouts(jl.data ?? [])
      }
      if (jd.success) setDesigns(jd.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (layouts.length && !pickId) setPickId(layouts[0]!.id)
  }, [layouts, pickId])

  const addSlide = () => {
    if (!pickId) return
    setOrderedSlideIds((prev) => [...prev, pickId])
  }

  const removeAt = (i: number) => {
    setOrderedSlideIds((prev) => prev.filter((_, j) => j !== i))
  }

  const move = (i: number, dir: -1 | 1) => {
    setOrderedSlideIds((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || orderedSlideIds.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const tags = tagsStr
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await fetch('/api/proposal-templates/design-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          tags,
          remarks: remarks.trim() || null,
          slideLayoutIds: orderedSlideIds,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error ?? '保存に失敗しました')
        return
      }
      setName('')
      setTagsStr('')
      setRemarks('')
      setOrderedSlideIds([])
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return
    const res = await fetch(`/api/proposal-templates/design-templates/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok || !json.success) {
      setError(json.error ?? '削除に失敗しました')
      return
    }
    await load()
  }

  const layoutName = (id: string) => layouts.find((l) => l.id === id)?.name ?? id

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-4 text-sm">
        <Link href="/proposal-templates" className="text-purple-700 hover:underline">
          ← テンプレート管理
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">デザインテンプレート登録</h1>
        <p className="text-sm text-gray-500 mt-1">
          スライド定義を<strong>順序付きで</strong>並べます。提案資料の枚数がこれより多い場合は、<strong>最後のスライド定義が繰り返し</strong>適用されます。
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">新規登録</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-xs text-gray-600">
            デザインテンプレート名
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              required
            />
          </label>
          <label className="block text-xs text-gray-600">
            タグ（この画面専用・カンマ区切り）
            <input
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </label>
          <label className="block text-xs text-gray-600">
            備考
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </label>

          <div className="rounded-lg border border-gray-100 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">スライドを順に追加</p>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={pickId}
                onChange={(e) => setPickId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[200px]"
              >
                {layouts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}（{l.page_kind}）
                  </option>
                ))}
              </select>
              <button type="button" onClick={addSlide} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
                追加
              </button>
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-800">
              {orderedSlideIds.map((id, i) => (
                <li key={`${id}-${i}`} className="flex flex-wrap items-center gap-2">
                  <span>{layoutName(id)}</span>
                  <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => move(i, -1)}>
                    上へ
                  </button>
                  <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => move(i, 1)}>
                    下へ
                  </button>
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removeAt(i)}>
                    削除
                  </button>
                </li>
              ))}
            </ol>
            {orderedSlideIds.length === 0 && <p className="text-xs text-gray-400">スライドを1件以上追加してください</p>}
          </div>

          <button
            type="submit"
            disabled={saving || orderedSlideIds.length === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? '保存中…' : '登録する'}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <h2 className="text-sm font-semibold text-gray-700 px-5 py-3 border-b border-gray-100">一覧</h2>
        {loading ? (
          <p className="p-5 text-sm text-gray-500">読み込み中…</p>
        ) : designs.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">まだ登録がありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2">名前</th>
                  <th className="px-4 py-2">タグ</th>
                  <th className="px-4 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {designs.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-2 text-gray-600">{(r.tags ?? []).join(', ') || '—'}</td>
                    <td className="px-4 py-2">
                      <button type="button" onClick={() => void handleDelete(r.id)} className="text-red-600 hover:underline text-xs">
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
