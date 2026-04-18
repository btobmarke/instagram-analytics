'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { ProposalDeckContentParsed } from '@/lib/instagram/proposal-deck/schema'
import type { ProposalOutline } from '@/lib/instagram/proposal-schemas'
import { ProposalHtmlSlides } from '@/lib/instagram/proposal-html/ProposalHtmlSlides'
import { DEFAULT_HTML_TEMPLATE_ID, getHtmlTemplate } from '@/lib/instagram/proposal-html/templates'
import { exportHtmlSlideElementsToPptx } from '@/lib/instagram/proposal-html/export-html-to-pptx'
import { sanitizePdfBasename } from '@/lib/pdf/download-html-as-pdf'
import { CustomProposalHtmlSlides } from '@/components/proposal-templates/CustomProposalHtmlSlides'
import {
  resolveDeckToCustomHtml,
  type ResolvedSlideRow,
} from '@/lib/instagram/proposal-templates/resolve-design-template'

export function InstagramProposalHtmlPanel({
  serviceId,
  serviceName,
  outline,
  deck,
  since,
  until,
}: {
  serviceId: string
  serviceName?: string
  outline: ProposalOutline | null
  deck: ProposalDeckContentParsed | null
  since: string | null
  until: string | null
}) {
  const [templateId, setTemplateId] = useState(DEFAULT_HTML_TEMPLATE_ID)
  /** 組み込み classic / magazine と、テンプレート管理で登録したデザイン */
  const [templateMode, setTemplateMode] = useState<'builtin' | 'custom'>('builtin')
  const [designTemplates, setDesignTemplates] = useState<{ id: string; name: string }[]>([])
  const [customDesignId, setCustomDesignId] = useState('')
  const [resolvedRows, setResolvedRows] = useState<ResolvedSlideRow[] | null>(null)
  const [customTemplateLoading, setCustomTemplateLoading] = useState(false)
  const [customTemplateError, setCustomTemplateError] = useState<string | null>(null)
  const [customCss, setCustomCss] = useState('')
  const [uploadedHtml, setUploadedHtml] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<Set<number>>(new Set())

  const slideRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/proposal-templates/design-templates')
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j.success) {
          const list = (j.data ?? []) as { id: string; name: string }[]
          setDesignTemplates(list)
          setCustomDesignId((prev) => prev || list[0]?.id || '')
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (templateMode !== 'custom' || !customDesignId) {
      setResolvedRows(null)
      setCustomTemplateError(null)
      return
    }
    let cancelled = false
    setCustomTemplateLoading(true)
    setCustomTemplateError(null)
    fetch(`/api/proposal-templates/design-templates/${customDesignId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (!j.success || !j.data?.slides?.length) {
          setResolvedRows(null)
          setCustomTemplateError(j.error ?? 'デザインテンプレートの取得に失敗しました')
          return
        }
        const rows = (j.data.slides as { resolved: ResolvedSlideRow }[]).map((s) => s.resolved)
        setResolvedRows(rows)
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedRows(null)
          setCustomTemplateError('デザインテンプレートの取得に失敗しました')
        }
      })
      .finally(() => {
        if (!cancelled) setCustomTemplateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [templateMode, customDesignId])

  const customSlideHtml = useMemo(() => {
    if (!deck || !resolvedRows?.length) return []
    return resolveDeckToCustomHtml(deck, resolvedRows)
  }, [deck, resolvedRows])

  useEffect(() => {
    const n = deck?.slides.length ?? 0
    slideRefs.current = new Array(n).fill(null)
    setSelectedForExport(new Set())
  }, [deck?.slides.length])

  const toggleExportSlide = useCallback((i: number) => {
    setSelectedForExport((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }, [])

  const runExport = useCallback(
    async (onlySelected: boolean) => {
      if (!deck) return
      setExporting(true)
      setExportError(null)
      try {
        const indices = onlySelected
          ? [...selectedForExport].sort((a, b) => a - b)
          : deck.slides.map((_, i) => i)
        const els = indices.map((i) => slideRefs.current[i])
        if (els.some((e) => !e)) {
          setExportError('スライドの描画を待ってから再度お試しください。')
          return
        }
        await exportHtmlSlideElementsToPptx(
          serviceId,
          els,
          sanitizePdfBasename(`proposal-html-${serviceName ?? 'instagram'}-${since ?? ''}-${until ?? ''}`),
        )
      } catch (e) {
        console.error(e)
        setExportError(e instanceof Error ? e.message : 'PPTX の生成に失敗しました')
      } finally {
        setExporting(false)
      }
    },
    [deck, selectedForExport, serviceId, serviceName, since, until],
  )

  const onHtmlFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      setUploadedHtml(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.readAsText(f)
  }, [])

  if (!outline) {
    return null
  }

  const tpl = getHtmlTemplate(templateId)

  const showBuiltinChrome = templateMode === 'builtin'

  return (
    <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-teal-900">案A · HTML スライドプレビュー</h3>
        <p className="text-xs text-teal-800/85 mt-1 leading-relaxed">
          下の「スライドデータを生成」と同じ JSON を、レイアウトワイヤー＋パーツで HTML 表示します。PPTX
          は各スライドを画像化して貼り付けます（レイアウトはプレビューに近づけますが、ベクター変換ではありません）。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-teal-900">
          デザインの出所
          <select
            value={templateMode}
            onChange={(e) => setTemplateMode(e.target.value as 'builtin' | 'custom')}
            className="mt-1 block w-full text-sm border border-teal-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="builtin">組み込み（クラシック / マガジン）</option>
            <option value="custom">テンプレート管理で登録したデザイン</option>
          </select>
        </label>
        {templateMode === 'builtin' ? (
          <label className="block text-xs text-teal-900">
            組み込みテンプレート
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="mt-1 block w-full text-sm border border-teal-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="classic">クラシック（A + B + F）</option>
              <option value="magazine">マガジン（A + C + G）</option>
            </select>
          </label>
        ) : (
          <label className="block text-xs text-teal-900">
            登録済みデザインテンプレート
            <select
              value={customDesignId}
              onChange={(e) => setCustomDesignId(e.target.value)}
              className="mt-1 block w-full text-sm border border-teal-200 rounded-lg px-3 py-2 bg-white"
              disabled={designTemplates.length === 0}
            >
              {designTemplates.length === 0 ? (
                <option value="">先にサイドメニュー「テンプレート管理」から登録してください</option>
              ) : (
                designTemplates.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))
              )}
            </select>
          </label>
        )}
      </div>

      {templateMode === 'builtin' && (
        <div className="text-[11px] text-teal-800/90">
          <p>
            表紙・KPI・章ごとに、組み込みの<strong>ワイヤー</strong>と<strong>パーツ</strong>が下表のとおり対応します。
          </p>
        </div>
      )}

      {templateMode === 'custom' && (
        <p className="text-[11px] text-teal-800/90">
          テンプレート管理で登録したスライド順が適用されます。提案の枚数が多い場合は<strong>最後のスライド定義を繰り返し</strong>使用します。
        </p>
      )}

      {customTemplateError && <p className="text-sm text-red-600">{customTemplateError}</p>}
      {templateMode === 'custom' && customTemplateLoading && (
        <p className="text-xs text-teal-700">デザインを読み込み中…</p>
      )}

      {showBuiltinChrome && (
        <div className="rounded-lg border border-teal-100 bg-white overflow-hidden text-xs">
          <table className="w-full text-left">
            <thead className="bg-teal-100/60 text-teal-900">
              <tr>
                <th className="px-3 py-2 font-medium">ページ種別</th>
                <th className="px-3 py-2 font-medium">レイアウトワイヤー</th>
                <th className="px-3 py-2 font-medium">パーツ</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              <tr className="border-t border-teal-50">
                <td className="px-3 py-2">表紙</td>
                <td className="px-3 py-2 font-mono text-[10px]">{tpl.rules.cover.wireId}</td>
                <td className="px-3 py-2">{tpl.rules.cover.parts.map((p) => p.label).join(' · ')}</td>
              </tr>
              <tr className="border-t border-teal-50">
                <td className="px-3 py-2">KPI</td>
                <td className="px-3 py-2 font-mono text-[10px]">{tpl.rules.kpi.wireId}</td>
                <td className="px-3 py-2">{tpl.rules.kpi.parts.map((p) => p.label).join(' · ')}</td>
              </tr>
              <tr className="border-t border-teal-50">
                <td className="px-3 py-2">各章</td>
                <td className="px-3 py-2 font-mono text-[10px]">{tpl.rules.section.wireId}</td>
                <td className="px-3 py-2">{tpl.rules.section.parts.map((p) => p.label).join(' · ')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <label className="block text-xs text-teal-900">
        追加 CSS（任意・プレビュー枠内のみ）
        <textarea
          value={customCss}
          onChange={(e) => setCustomCss(e.target.value)}
          rows={3}
          placeholder={`/* 例 */\n.proposal-html-scope h1 { font-size: 28px; }\n.proposal-html-scope .text-teal-700 { color: #0f766e; }`}
          className="mt-1 w-full text-xs font-mono border border-teal-200 rounded-lg px-2 py-1.5 bg-white"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-teal-800">HTML ファイル（参考表示・任意）</span>
        <input type="file" accept=".html,text/html" className="text-xs" onChange={onHtmlFile} />
      </div>
      {uploadedHtml && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-2 text-[11px] text-amber-900">
          アップロード済み（スクリプトは実行しません）。Figma/MCP からの HTML を貼る際の参考用です。
          <iframe
            title="uploaded-html-preview"
            className="mt-2 w-full h-40 rounded border border-amber-200 bg-white"
            sandbox=""
            srcDoc={uploadedHtml}
          />
        </div>
      )}

      {!deck && (
        <p className="text-sm text-teal-700">先に「スライドデータを生成」を実行するとプレビューが表示されます。</p>
      )}

      {exportError && <p className="text-sm text-red-600">{exportError}</p>}

      {deck && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={() => void runExport(false)}
              className="px-3 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {exporting ? 'PPTX 生成中…' : 'PPTX（HTML→画像）全体'}
            </button>
            <button
              type="button"
              disabled={exporting || selectedForExport.size === 0}
              onClick={() => void runExport(true)}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-teal-300 bg-white text-teal-900 hover:bg-teal-50 disabled:opacity-50"
            >
              選択スライドのみ PPTX
            </button>
          </div>
          <p className="text-[11px] text-teal-700">
            チェックでエクスポート対象を選べます。本文の編集は下の「案B」フォームで行うと HTML にも反映されます。
          </p>

          <div className="proposal-html-scope relative">
            {customCss.trim() ? <style dangerouslySetInnerHTML={{ __html: customCss }} /> : null}
            <div className="space-y-2">
              {deck.slides.map((_, idx) => (
                <label key={idx} className="flex items-center gap-2 text-xs text-teal-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedForExport.has(idx)}
                    onChange={() => toggleExportSlide(idx)}
                  />
                  スライド {idx + 1} をエクスポートに含める
                </label>
              ))}
            </div>
            {templateMode === 'builtin' ? (
              <ProposalHtmlSlides deck={deck} template={tpl} slideRefs={slideRefs} />
            ) : resolvedRows?.length ? (
              <CustomProposalHtmlSlides deck={deck} slideHtml={customSlideHtml} slideRefs={slideRefs} />
            ) : (
              <p className="text-sm text-amber-700">
                {designTemplates.length === 0
                  ? 'テンプレート管理でデザインを登録するとプレビューできます。'
                  : 'デザインの解決に失敗しているか、読み込み中です。'}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
