'use client'

import { useState, useCallback, useRef } from 'react'
import { MarkdownRenderer } from '@/components/ai/MarkdownRenderer'
import { InstagramProposalDeckPanel } from '@/components/instagram/InstagramProposalDeckPanel'
import { InstagramProposalHtmlPanel } from '@/components/instagram/InstagramProposalHtmlPanel'
import { downloadHtmlAsPdf, sanitizePdfBasename } from '@/lib/pdf/download-html-as-pdf'
import type { ProposalOutline } from '@/lib/instagram/proposal-schemas'
import type { ProposalPeriodPreset } from '@/lib/instagram/proposal-context'
import type { ProposalDeckContentParsed } from '@/lib/instagram/proposal-deck/schema'

type ChatMsg = { role: 'user' | 'assistant'; content: string }

export function InstagramProposalPanel({
  serviceId,
  serviceName,
  accountId,
}: {
  serviceId: string
  serviceName?: string
  accountId?: string | null
}) {
  const [preset, setPreset] = useState<ProposalPeriodPreset>('30d')
  const [customSince, setCustomSince] = useState('')
  const [customUntil, setCustomUntil] = useState('')
  const [outlineLoading, setOutlineLoading] = useState(false)
  const [docLoading, setDocLoading] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [digest, setDigest] = useState<string | null>(null)
  const [since, setSince] = useState<string | null>(null)
  const [until, setUntil] = useState<string | null>(null)
  const [outline, setOutline] = useState<ProposalOutline | null>(null)

  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [refinementNotes, setRefinementNotes] = useState('')

  const [markdown, setMarkdown] = useState<string | null>(null)
  const pdfRef = useRef<HTMLDivElement>(null)
  const [pdfExporting, setPdfExporting] = useState(false)

  /** 案A・案B 共通のスライド JSON */
  const [proposalDeck, setProposalDeck] = useState<ProposalDeckContentParsed | null>(null)
  const [deckFillLoading, setDeckFillLoading] = useState(false)

  const updateSection = useCallback(
    (index: number, patch: Partial<ProposalOutline['sections'][number]>) => {
      setOutline((prev) => {
        if (!prev) return prev
        const sections = [...prev.sections]
        sections[index] = { ...sections[index], ...patch }
        return { ...prev, sections }
      })
    },
    [],
  )

  const handleGenerateOutline = useCallback(async () => {
    setError(null)
    setOutlineLoading(true)
    try {
      const body: Record<string, unknown> = { periodPreset: preset }
      if (preset === 'custom') {
        body.periodStart = customSince
        body.periodEnd = customUntil
      }
      const res = await fetch(`/api/services/${serviceId}/instagram/proposal/outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        setError(typeof json.error === 'string' ? json.error : '構成案の取得に失敗しました')
        return
      }
      setOutline(json.data.outline as ProposalOutline)
      setDigest(json.data.digest as string)
      setSince(json.data.since as string)
      setUntil(json.data.until as string)
      setChatMessages([])
      setMarkdown(null)
      setProposalDeck(null)
    } finally {
      setOutlineLoading(false)
    }
  }, [serviceId, preset, customSince, customUntil])

  const handleFillProposalDeck = useCallback(async () => {
    if (!outline || !digest?.trim() || !since || !until) return
    setError(null)
    setDeckFillLoading(true)
    try {
      const res = await fetch(`/api/services/${serviceId}/instagram/proposal-deck/fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline, digest, since, until }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        setError(typeof json.error === 'string' ? json.error : 'スライドデータの生成に失敗しました')
        return
      }
      setProposalDeck(json.data.deck as ProposalDeckContentParsed)
    } finally {
      setDeckFillLoading(false)
    }
  }, [serviceId, outline, digest, since, until])

  const handleSendChat = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || !outline || !digest) return
    setError(null)
    setChatLoading(true)
    const next: ChatMsg[] = [...chatMessages, { role: 'user', content: text }]
    setChatMessages(next)
    setChatInput('')
    try {
      const res = await fetch(`/api/services/${serviceId}/instagram/proposal/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outline,
          digest,
          messages: next,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        setError(typeof json.error === 'string' ? json.error : 'チャットに失敗しました')
        return
      }
      const reply = json.data?.reply as string
      if (reply) {
        setChatMessages([...next, { role: 'assistant', content: reply }])
      }
    } finally {
      setChatLoading(false)
    }
  }, [chatInput, chatMessages, digest, outline, serviceId])

  const handleGenerateDocument = useCallback(async () => {
    if (!outline || !digest) return
    setError(null)
    setDocLoading(true)
    try {
      const res = await fetch(`/api/services/${serviceId}/instagram/proposal/document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outline,
          digest,
          refinementNotes: refinementNotes.trim() || undefined,
          since: since ?? undefined,
          until: until ?? undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        setError(typeof json.error === 'string' ? json.error : '本文の生成に失敗しました')
        return
      }
      setMarkdown(json.data.markdown as string)
    } finally {
      setDocLoading(false)
    }
  }, [digest, outline, refinementNotes, serviceId, since, until])

  const handlePdf = useCallback(async () => {
    const el = pdfRef.current
    if (!el || !markdown?.trim()) return
    setPdfExporting(true)
    try {
      const base = sanitizePdfBasename(
        `instagram-proposal-${serviceName ?? 'instagram'}-${since ?? ''}-${until ?? ''}`,
      )
      await downloadHtmlAsPdf(el, base)
    } catch (e) {
      console.error(e)
      window.alert('PDF の保存に失敗しました。')
    } finally {
      setPdfExporting(false)
    }
  }, [markdown, serviceName, since, until])

  if (!accountId) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-4 py-6 text-sm text-gray-500">
        Instagram アカウントを連携すると、提案資料機能が利用できます。
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-gray-800">クライアント向け提案資料</h2>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          指定期間の Instagram データだけを材料に、構成案 → 相談（任意）→ 本文（Markdown）→ PDF 保存まで行えます。
        </p>
      </div>

      {/* 期間 */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">
          分析期間
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as ProposalPeriodPreset)}
            className="mt-1 block text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="7d">直近7日</option>
            <option value="30d">直近30日</option>
            <option value="90d">直近90日</option>
            <option value="custom">日付を指定</option>
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="text-xs text-gray-600">
              開始
              <input
                type="date"
                value={customSince}
                onChange={(e) => setCustomSince(e.target.value)}
                className="mt-1 block text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-xs text-gray-600">
              終了
              <input
                type="date"
                value={customUntil}
                onChange={(e) => setCustomUntil(e.target.value)}
                className="mt-1 block text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </label>
          </>
        )}
        <button
          type="button"
          disabled={outlineLoading}
          onClick={() => void handleGenerateOutline()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50"
        >
          {outlineLoading ? '生成中…' : '構成案を生成'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* 構成案編集 */}
      {outline && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">構成案の確認・編集</h3>
          <label className="block text-xs text-gray-600">
            資料タイトル
            <input
              type="text"
              value={outline.document_title}
              onChange={(e) => setOutline({ ...outline, document_title: e.target.value })}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </label>
          <label className="block text-xs text-gray-600">
            想定読者（任意）
            <input
              type="text"
              value={outline.audience ?? ''}
              onChange={(e) => setOutline({ ...outline, audience: e.target.value || undefined })}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </label>
          <ul className="space-y-3">
            {outline.sections.map((sec, i) => (
              <li key={sec.id} className="rounded-lg border border-gray-100 bg-gray-50/80 p-3 space-y-2">
                <p className="text-[10px] font-semibold text-gray-400">第 {i + 1} 章</p>
                <input
                  type="text"
                  value={sec.title}
                  onChange={(e) => updateSection(i, { title: e.target.value })}
                  className="w-full text-sm font-medium border border-gray-200 rounded-lg px-2 py-1.5"
                />
                <textarea
                  value={sec.purpose ?? ''}
                  onChange={(e) => updateSection(i, { purpose: e.target.value })}
                  placeholder="この章の目的（任意）"
                  rows={2}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5"
                />
                <textarea
                  value={(sec.key_points ?? []).join('\n')}
                  onChange={(e) =>
                    updateSection(i, {
                      key_points: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="要点（1行に1つ）"
                  rows={3}
                  className="w-full text-xs font-mono border border-gray-200 rounded-lg px-2 py-1.5"
                />
              </li>
            ))}
          </ul>
          {since && until && (
            <p className="text-xs text-gray-400">
              対象期間: {since} ～ {until}
            </p>
          )}
        </div>
      )}

      {/* チャット */}
      {outline && digest && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">構成・トーンの相談（任意）</h3>
          <div className="max-h-48 overflow-y-auto space-y-2 text-sm">
            {chatMessages.length === 0 ? (
              <p className="text-gray-400 text-xs">例: 「提案パートをもう1章増やしたい」「数字の見せ方を変えたい」</p>
            ) : (
              chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg px-3 py-2 whitespace-pre-wrap ${m.role === 'user' ? 'bg-pink-50 text-gray-800 ml-4' : 'bg-gray-50 text-gray-700 mr-4'}`}
                >
                  {m.content}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void handleSendChat())}
              placeholder="メッセージを入力…"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
            <button
              type="button"
              disabled={chatLoading || !chatInput.trim()}
              onClick={() => void handleSendChat()}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
            >
              送信
            </button>
          </div>
        </div>
      )}

      {outline && digest && since && until && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-gradient-to-r from-slate-50 to-gray-50 p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              スライドデータ（案A・B 共通）
            </h3>
            <p className="text-xs text-gray-600 mb-3">
              構成案とデータ要約から JSON を1回生成します。案A は HTML プレビュー、案B はネイティブ PPTX の両方に使います。
            </p>
            <button
              type="button"
              disabled={deckFillLoading}
              onClick={() => void handleFillProposalDeck()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {deckFillLoading ? '生成中…' : 'スライドデータを生成'}
            </button>
          </div>

          <InstagramProposalHtmlPanel
            serviceId={serviceId}
            serviceName={serviceName}
            outline={outline}
            deck={proposalDeck}
            since={since}
            until={until}
          />

          <InstagramProposalDeckPanel
            serviceId={serviceId}
            serviceName={serviceName}
            deck={proposalDeck}
            setDeck={setProposalDeck}
            since={since}
            until={until}
          />
        </div>
      )}

      {/* 本文生成 */}
      {outline && digest && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">本文生成（Markdown・PDF）</h3>
          <label className="block text-xs text-gray-600">
            資料に反映する追加指示（任意・チャット以外の一文でも可）
            <textarea
              value={refinementNotes}
              onChange={(e) => setRefinementNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              placeholder="例: 危機感は出さず前向きに。次月のアクションを表形式で。"
            />
          </label>
          <button
            type="button"
            disabled={docLoading}
            onClick={() => void handleGenerateDocument()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {docLoading ? '本文を生成中…' : '提案資料の本文を生成'}
          </button>
        </div>
      )}

      {/* プレビュー & PDF */}
      {markdown && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              disabled={pdfExporting}
              onClick={() => void handlePdf()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {pdfExporting ? 'PDF生成中…' : 'PDFで保存'}
            </button>
          </div>
          <div
            ref={pdfRef}
            className="rounded-lg border border-gray-100 bg-white p-4 prose prose-sm max-w-none [print-color-adjust:exact]"
          >
            <div className="text-xs text-gray-400 mb-3 pb-2 border-b border-gray-100">
              {serviceName ?? 'Instagram'} · 提案資料 · {since ?? ''} ～ {until ?? ''}
            </div>
            <MarkdownRenderer content={markdown} />
          </div>
        </div>
      )}
    </div>
  )
}
