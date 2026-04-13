'use client'

import { use, useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useCompletion } from '@ai-sdk/react'
import type { AiAnalysisResult } from '@/types'
import { MarkdownRenderer, BlinkingCursor } from '@/components/ai/MarkdownRenderer'
import { downloadHtmlAsPdf } from '@/lib/pdf/download-html-as-pdf'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
  type_config: { ig_account_ref_id?: string } | null
}

function formatAnalysisType(t: string): string {
  if (t === 'account_weekly') return '週次'
  if (t === 'account_monthly') return '月次'
  return t
}

export default function InstagramAiReportPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [analysisType, setAnalysisType] = useState<'weekly' | 'monthly'>('weekly')
  const [selected, setSelected] = useState<AiAnalysisResult | null>(null)
  const [pdfExporting, setPdfExporting] = useState(false)
  const liveReportPdfRef = useRef<HTMLDivElement>(null)
  const historyReportPdfRef = useRef<HTMLDivElement>(null)

  const { data: serviceData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = serviceData?.data
  const accountId = service?.type_config?.ig_account_ref_id

  const historyUrl =
    analysisType === 'weekly'
      ? `/api/services/${serviceId}/ai/report?type=account_weekly`
      : `/api/services/${serviceId}/ai/report?type=account_monthly`

  const { data: historyJson, mutate: mutateHistory } = useSWR<{ data: AiAnalysisResult[] }>(
    accountId ? historyUrl : null,
    fetcher
  )
  const history = historyJson?.data ?? []

  useEffect(() => {
    if (history.length > 0 && !selected) {
      setSelected(history[0])
    }
  }, [history, selected])

  const { completion, complete, isLoading, error } = useCompletion({
    api: `/api/services/${serviceId}/ai/report`,
    streamProtocol: 'data',
    onFinish: () => {
      void mutateHistory()
    },
  })

  const handleGenerate = useCallback(() => {
    void complete('', { body: { analysisType } })
  }, [complete, analysisType])

  const pdfFilenameBase = useCallback(
    (suffix: string) => {
      const svc = service?.service_name ?? 'instagram'
      const typeLabel = analysisType === 'weekly' ? 'weekly' : 'monthly'
      return `instagram-ai-${svc}-${typeLabel}-${suffix}`
    },
    [service?.service_name, analysisType]
  )

  const handleExportLivePdf = useCallback(async () => {
    const el = liveReportPdfRef.current
    if (!el || !completion.trim()) return
    setPdfExporting(true)
    try {
      await downloadHtmlAsPdf(el, pdfFilenameBase(new Date().toISOString().slice(0, 10)))
    } catch (e) {
      console.error(e)
      window.alert('PDF の保存に失敗しました。しばらくしてから再度お試しください。')
    } finally {
      setPdfExporting(false)
    }
  }, [completion, pdfFilenameBase])

  const handleExportHistoryPdf = useCallback(async () => {
    const el = historyReportPdfRef.current
    if (!el || !selected || typeof selected.analysis_result !== 'string' || !selected.analysis_result.trim())
      return
    setPdfExporting(true)
    try {
      const typeLabel = formatAnalysisType(selected.analysis_type)
      const d = new Date(selected.created_at).toISOString().slice(0, 10)
      const svc = service?.service_name ?? 'report'
      await downloadHtmlAsPdf(el, `instagram-ai-${svc}-${typeLabel}-${d}`)
    } catch (e) {
      console.error(e)
      window.alert('PDF の保存に失敗しました。しばらくしてから再度お試しください。')
    } finally {
      setPdfExporting(false)
    }
  }, [selected, service?.service_name])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 w-full">
      <nav className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
        <Link href="/clients" className="hover:text-purple-600">
          クライアント一覧
        </Link>
        <span>›</span>
        <Link href={`/clients/${service?.client.id}`} className="hover:text-purple-600">
          {service?.client.client_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">
          {service?.project.project_name}
        </Link>
        <span>›</span>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram`}
          className="hover:text-pink-600"
        >
          {service?.service_name ?? 'Instagram'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">AI分析</span>
      </nav>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-xl">
          📸
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instagram</h1>
          <p className="text-sm text-gray-400">{service?.service_name}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/analytics`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          ダッシュボード
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/posts`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          投稿一覧
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram/ai`}
          className="px-4 py-2.5 text-sm font-medium text-pink-600 border-b-2 border-pink-600 -mb-px"
        >
          AI分析
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/instagram`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          設定
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/summary`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          サマリー
        </Link>
      </div>

      {!accountId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center text-amber-800">
          <p className="font-semibold mb-1">Instagram アカウントが未連携です</p>
          <Link
            href={`/projects/${projectId}/services/${serviceId}/instagram`}
            className="text-sm text-amber-700 font-medium hover:underline"
          >
            ← サービスページでアカウントを連携する
          </Link>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">レポート生成</h2>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={analysisType}
                onChange={(e) => {
                  const v = e.target.value as 'weekly' | 'monthly'
                  setAnalysisType(v)
                  setSelected(null)
                }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300"
              >
                <option value="weekly">週次分析（直近7日）</option>
                <option value="monthly">月次分析（直近30日）</option>
              </select>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-purple-300 border-t-white rounded-full animate-spin" />
                ) : (
                  <span aria-hidden>✨</span>
                )}
                {isLoading ? 'AI分析中...' : 'AI分析を実行'}
              </button>
            </div>
            {error && (
              <p className="mt-3 text-sm text-red-600">
                {error.message || 'エラーが発生しました'}
              </p>
            )}
            {(completion || isLoading) && (
              <div className="mt-6 border-t border-gray-100 pt-6">
                <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
                  {completion.trim() && !isLoading && (
                    <button
                      type="button"
                      onClick={() => void handleExportLivePdf()}
                      disabled={pdfExporting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                    >
                      <span aria-hidden>📄</span>
                      {pdfExporting ? 'PDF生成中…' : 'PDFで保存'}
                    </button>
                  )}
                </div>
                <div
                  ref={liveReportPdfRef}
                  className="rounded-lg border border-gray-100 bg-white p-4 [print-color-adjust:exact]"
                >
                  <div className="text-xs text-gray-500 mb-3 pb-2 border-b border-gray-100">
                    {service?.client.client_name} / {service?.service_name} ·{' '}
                    {analysisType === 'weekly' ? '週次分析' : '月次分析'} ·{' '}
                    {new Date().toLocaleString('ja-JP')}
                  </div>
                  <MarkdownRenderer content={completion} />
                </div>
                {isLoading && <BlinkingCursor />}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">過去の分析</h2>
            {history.length === 0 ? (
              <p className="text-sm text-gray-400">まだ履歴がありません</p>
            ) : (
              <div className="flex flex-col md:flex-row gap-4">
                <ul className="md:w-52 flex-shrink-0 space-y-1 border-b md:border-b-0 md:border-r border-gray-100 md:pr-4 pb-4 md:pb-0">
                  {history.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition ${
                          selected?.id === row.id
                            ? 'bg-purple-50 text-purple-700 font-medium'
                            : 'text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        <span className="block">{formatAnalysisType(row.analysis_type)}</span>
                        <span className="text-gray-400">
                          {new Date(row.created_at).toLocaleString('ja-JP')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex-1 min-w-0">
                  {selected?.analysis_result ? (
                    typeof selected.analysis_result === 'string' ? (
                      <>
                        <div className="flex flex-wrap justify-end gap-2 mb-3">
                          <button
                            type="button"
                            onClick={() => void handleExportHistoryPdf()}
                            disabled={pdfExporting || !selected.analysis_result.trim()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                          >
                            <span aria-hidden>📄</span>
                            {pdfExporting ? 'PDF生成中…' : 'PDFで保存'}
                          </button>
                        </div>
                        <div
                          ref={historyReportPdfRef}
                          className="rounded-lg border border-gray-100 bg-white p-4 [print-color-adjust:exact]"
                        >
                          <div className="text-xs text-gray-500 mb-3 pb-2 border-b border-gray-100">
                            {service?.client.client_name} / {service?.service_name} ·{' '}
                            {formatAnalysisType(selected.analysis_type)} ·{' '}
                            {new Date(selected.created_at).toLocaleString('ja-JP')}
                          </div>
                          <MarkdownRenderer content={selected.analysis_result} />
                        </div>
                      </>
                    ) : (
                      <pre className="text-xs whitespace-pre-wrap overflow-x-auto">
                        {JSON.stringify(selected.analysis_result, null, 2)}
                      </pre>
                    )
                  ) : (
                    <p className="text-gray-400">左の一覧から履歴を選択してください</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
