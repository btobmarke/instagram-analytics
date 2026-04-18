'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type WirePart = { id: string; name: string; element_kind: string }
type SlideLayout = {
  id: string
  name: string
  page_kind: string
  tags: string[]
  wire_element_id: string
}

export default function ProposalSlidesPage() {
  const [wires, setWires] = useState<WirePart[]>([])
  const [parts, setParts] = useState<WirePart[]>([])
  const [layouts, setLayouts] = useState<SlideLayout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [remarks, setRemarks] = useState('')
  const [pageKind, setPageKind] = useState<'cover' | 'kpi' | 'section'>('cover')
  const [wireId, setWireId] = useState('')
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rw, rp, sl] = await Promise.all([
        fetch('/api/proposal-templates/wire-parts?kind=wire'),
        fetch('/api/proposal-templates/wire-parts?kind=part'),
        fetch('/api/proposal-templates/slide-layouts'),
      ])
      const [jw, jp, jl] = await Promise.all([rw.json(), rp.json(), sl.json()])
      if (jw.success) setWires(jw.data ?? [])
      if (jp.success) setParts(jp.data ?? [])
      if (jl.success) setLayouts(jl.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (wires.length && !wireId) setWireId(wires[0]!.id)
  }, [wires, wireId])

  const togglePart = (id: string) => {
    setSelectedParts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !wireId) return
    setSaving(true)
    setError(null)
    try {
      const tags = tagsStr
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const partElementIds = parts.filter((p) => selectedParts.has(p.id)).map((p) => p.id)
      const res = await fetch('/api/proposal-templates/slide-layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          tags,
          remarks: remarks.trim() || null,
          pageKind,
          wireElementId: wireId,
          partElementIds,
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
      setSelectedParts(new Set())
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return
    const res = await fetch(`/api/proposal-templates/slide-layouts/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok || !json.success) {
      setError(json.error ?? '削除に失敗しました')
      return
    }
    await load()
  }

  const pkLabel = (k: string) =>
    k === 'cover' ? '表紙' : k === 'kpi' ? 'KPI' : '章'

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-4 text-sm">
        <Link href="/proposal-templates" className="text-purple-700 hover:underline">
          ← テンプレート管理
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">スライド登録</h1>
        <p className="text-sm text-gray-500 mt-1">
          ワイヤー1件とパーツ（複数・チェック順は一覧の並び）を組み合わせます。ページ種別は提案JSONの表紙/KPI/章に対応する目安です。
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">新規登録</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-xs text-gray-600">
              スライド名
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                required
              />
            </label>
            <label className="block text-xs text-gray-600">
              ページ種別（目安）
              <select
                value={pageKind}
                onChange={(e) => setPageKind(e.target.value as 'cover' | 'kpi' | 'section')}
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              >
                <option value="cover">表紙（cover）</option>
                <option value="kpi">KPI（kpi）</option>
                <option value="section">章（section）</option>
              </select>
            </label>
          </div>
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
          <label className="block text-xs text-gray-600">
            ワイヤー（1つ）
            <select
              value={wireId}
              onChange={(e) => setWireId(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              required
            >
              {wires.length === 0 ? <option value="">先にワイヤーを登録してください</option> : null}
              {wires.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-gray-600">
            <span className="font-medium">パーツ（複数可・チェック順で結合）</span>
            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border border-gray-100 rounded-lg p-2">
              {parts.length === 0 ? (
                <p className="text-gray-400">パーツを先に登録してください</p>
              ) : (
                parts.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedParts.has(p.id)} onChange={() => togglePart(p.id)} />
                    {p.name}
                  </label>
                ))
              )}
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || wires.length === 0}
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
        ) : layouts.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">まだ登録がありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2">スライド名</th>
                  <th className="px-4 py-2">種別</th>
                  <th className="px-4 py-2">タグ</th>
                  <th className="px-4 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {layouts.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-2">{pkLabel(r.page_kind)}</td>
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
