'use client'

import { useState, useCallback } from 'react'
import type { ProposalDeckContentParsed } from '@/lib/instagram/proposal-deck/schema'
import { sanitizePdfBasename } from '@/lib/pdf/download-html-as-pdf'

export function InstagramProposalDeckPanel({
  serviceId,
  serviceName,
  deck,
  setDeck,
  since,
  until,
}: {
  serviceId: string
  serviceName?: string
  deck: ProposalDeckContentParsed | null
  setDeck: React.Dispatch<React.SetStateAction<ProposalDeckContentParsed | null>>
  since: string | null
  until: string | null
}) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndices, setSelectedIndices] = useState<number[] | null>(null)

  const downloadBlob = useCallback(
    async (slideIndices?: number[]) => {
      if (!deck) return
      setExporting(true)
      setError(null)
      try {
        const res = await fetch(`/api/services/${serviceId}/instagram/proposal-deck/export/pptx`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deck,
            filenameBase: sanitizePdfBasename(
              `proposal-deck-${serviceName ?? 'instagram'}-${since ?? ''}-${until ?? ''}`,
            ),
            slideIndices,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(typeof j.error === 'string' ? j.error : 'PPTX の生成に失敗しました')
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${sanitizePdfBasename(`proposal-deck-${since ?? ''}`)}.pptx`
        a.click()
        URL.revokeObjectURL(url)
      } finally {
        setExporting(false)
      }
    },
    [deck, serviceId, serviceName, since, until],
  )

  const toggleIndex = useCallback((i: number) => {
    setSelectedIndices((prev) => {
      if (prev === null) return [i]
      const set = new Set(prev)
      if (set.has(i)) set.delete(i)
      else set.add(i)
      return [...set].sort((a, b) => a - b)
    })
  }, [])

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-indigo-900">案B · 構造化 PPTX（ネイティブ）</h3>
        <p className="text-xs text-indigo-700/80 mt-1 leading-relaxed">
          同じスライド JSON をサーバで pptxgenjs により直接組み立てます。下でテキストを編集すると案A の HTML プレビューにも反映されます。
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {deck && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void downloadBlob()}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
          >
            {exporting ? '出力中…' : 'PPTX 全体をダウンロード'}
          </button>
          {selectedIndices && selectedIndices.length > 0 && (
            <button
              type="button"
              disabled={exporting}
              onClick={() => void downloadBlob(selectedIndices)}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
            >
              選択スライドのみ PPTX
            </button>
          )}
        </div>
      )}

      {deck && (
        <div className="space-y-3">
          <p className="text-[11px] text-indigo-600">
            スライドをクリックで選択（複数可）→「選択スライドのみ」で部分出力。
          </p>
          {deck.slides.map((slide, idx) => (
            <SlideEditorCard
              key={`${slide.pageKey}-${idx}`}
              index={idx}
              slide={slide}
              selected={selectedIndices?.includes(idx) ?? false}
              onToggleSelect={() => toggleIndex(idx)}
              onChange={(next) => {
                setDeck((d) => {
                  if (!d) return d
                  const slides = [...d.slides]
                  slides[idx] = next
                  return { ...d, slides }
                })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SlideEditorCard({
  index,
  slide,
  selected,
  onToggleSelect,
  onChange,
}: {
  index: number
  slide: ProposalDeckContentParsed['slides'][number]
  selected: boolean
  onToggleSelect: () => void
  onChange: (s: ProposalDeckContentParsed['slides'][number]) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggleSelect}
      onKeyDown={(e) => e.key === 'Enter' && onToggleSelect()}
      className={`rounded-lg border p-3 text-left transition-colors ${
        selected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase text-gray-400">
          #{index + 1} · {slide.pageKey}
          {slide.pageKey === 'section' ? ` · ${slide.sectionId}` : ''}
        </span>
        <span className="text-[10px] text-gray-400">{selected ? '選択中' : 'クリックで選択'}</span>
      </div>
      <div onClick={(e) => e.stopPropagation()} className="space-y-2">
        {slide.pageKey === 'cover' && (
          <>
            <label className="block text-xs text-gray-600">
              タイトル
              <input
                type="text"
                value={slide.slots.title}
                onChange={(e) =>
                  onChange({ ...slide, slots: { ...slide.slots, title: e.target.value } })
                }
                className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
              />
            </label>
            <label className="block text-xs text-gray-600">
              サブタイトル
              <textarea
                value={slide.slots.subtitle}
                onChange={(e) =>
                  onChange({ ...slide, slots: { ...slide.slots, subtitle: e.target.value } })
                }
                rows={2}
                className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
              />
            </label>
          </>
        )}
        {slide.pageKey === 'kpi' && (
          <>
            <label className="block text-xs text-gray-600">
              見出し
              <input
                type="text"
                value={slide.slots.title}
                onChange={(e) =>
                  onChange({ ...slide, slots: { ...slide.slots, title: e.target.value } })
                }
                className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
              />
            </label>
            <MetricRowsEditor
              rows={slide.slots.metric_rows}
              onChange={(metric_rows) => onChange({ ...slide, slots: { ...slide.slots, metric_rows } })}
            />
          </>
        )}
        {slide.pageKey === 'section' && (
          <>
            <label className="block text-xs text-gray-600">
              見出し
              <input
                type="text"
                value={slide.slots.title}
                onChange={(e) =>
                  onChange({ ...slide, slots: { ...slide.slots, title: e.target.value } })
                }
                className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
              />
            </label>
            <label className="block text-xs text-gray-600">
              本文
              <textarea
                value={slide.slots.body}
                onChange={(e) =>
                  onChange({ ...slide, slots: { ...slide.slots, body: e.target.value } })
                }
                rows={4}
                className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
              />
            </label>
            <label className="block text-xs text-gray-600">
              箇条書き（1行に1つ）
              <textarea
                value={slide.slots.bullets.join('\n')}
                onChange={(e) =>
                  onChange({
                    ...slide,
                    slots: {
                      ...slide.slots,
                      bullets: e.target.value
                        .split('\n')
                        .map((s) => s.replace(/^•\s*/, '').trim())
                        .filter(Boolean),
                    },
                  })
                }
                rows={4}
                className="mt-0.5 w-full text-xs font-mono border border-gray-200 rounded px-2 py-1"
              />
            </label>
          </>
        )}
      </div>
    </div>
  )
}

function MetricRowsEditor({
  rows,
  onChange,
}: {
  rows: { label: string; value: string }[]
  onChange: (r: { label: string; value: string }[]) => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-600">指標テーブル</p>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            value={row.label}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...next[i], label: e.target.value }
              onChange(next)
            }}
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
            placeholder="指標"
          />
          <input
            type="text"
            value={row.value}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...next[i], value: e.target.value }
              onChange(next)
            }}
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
            placeholder="値"
          />
          <button
            type="button"
            className="text-xs text-red-600 px-1"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-indigo-600"
        onClick={() => onChange([...rows, { label: '', value: '' }])}
      >
        + 行を追加
      </button>
    </div>
  )
}
