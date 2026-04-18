'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type ElementRow = {
  id: string
  name: string
  element_kind: 'wire' | 'part'
  tags: string[]
  remarks: string | null
  html_content: string
  updated_at: string
}

export default function ProposalWirePartsPage() {
  const [rows, setRows] = useState<ElementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [kind, setKind] = useState<'wire' | 'part'>('wire')
  const [tagsStr, setTagsStr] = useState('')
  const [remarks, setRemarks] = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/proposal-templates/wire-parts')
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error ?? '読み込みに失敗しました')
        return
      }
      setRows(json.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !htmlContent.trim()) return
    setSaving(true)
    setError(null)
    try {
      const tags = tagsStr
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await fetch('/api/proposal-templates/wire-parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          elementKind: kind,
          tags,
          remarks: remarks.trim() || null,
          htmlContent,
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
      setHtmlContent('')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return
    const res = await fetch(`/api/proposal-templates/wire-parts/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok || !json.success) {
      setError(json.error ?? '削除に失敗しました')
      return
    }
    await load()
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setHtmlContent(reader.result)
    }
    reader.readAsText(f)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-4 text-sm">
        <Link href="/proposal-templates" className="text-purple-700 hover:underline">
          ← テンプレート管理
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ワイヤー / パーツ登録</h1>
        <p className="text-sm text-gray-500 mt-1">
          ワイヤーHTMLには <code className="bg-gray-100 px-1 rounded">{'{{PARTS}}'}</code> を置くとパーツHTMLが順に結合されます。パーツ・ワイヤー共通で{' '}
          <code className="bg-gray-100 px-1">{'{{title}}'}</code> <code className="bg-gray-100 px-1">{'{{subtitle}}'}</code>{' '}
          <code className="bg-gray-100 px-1">{'{{body}}'}</code> <code className="bg-gray-100 px-1">{'{{bullets}}'}</code>{' '}
          <code className="bg-gray-100 px-1">{'{{metric_rows}}'}</code>（KPI表）がスライド種別に応じて差し込まれます。
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">新規登録</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-xs text-gray-600">
              名称
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                required
              />
            </label>
            <label className="block text-xs text-gray-600">
              種別
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as 'wire' | 'part')}
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              >
                <option value="wire">ワイヤー</option>
                <option value="part">パーツ</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-gray-600">
            タグ（この画面専用・カンマ区切り）
            <input
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              placeholder="例: 表紙, シンプル"
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
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span>HTML ファイル</span>
            <input type="file" accept=".html,text/html" onChange={onFile} className="text-xs" />
          </div>
          <label className="block text-xs text-gray-600">
            HTML 本文
            <textarea
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              rows={12}
              className="mt-1 w-full text-xs font-mono border border-gray-200 rounded-lg px-2 py-2"
              required
            />
          </label>
          <button
            type="submit"
            disabled={saving}
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
        ) : rows.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">まだ登録がありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2">名称</th>
                  <th className="px-4 py-2">種別</th>
                  <th className="px-4 py-2">タグ</th>
                  <th className="px-4 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-2">{r.element_kind === 'wire' ? 'ワイヤー' : 'パーツ'}</td>
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
