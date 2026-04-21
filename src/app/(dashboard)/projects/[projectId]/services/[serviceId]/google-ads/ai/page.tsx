'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useCompletion } from '@ai-sdk/react'
import type { AiServiceAnalysisResult } from '@/types'
import { MarkdownRenderer, BlinkingCursor } from '@/components/ai/MarkdownRenderer'

export default function GoogleAdsAiPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const fetcher = (url: string) => fetch(url).then((r) => r.json())

  const { data: svcData } = useSWR<{ success: boolean; data: any }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = svcData?.data

  const [analysisType, setAnalysisType] = useState<'weekly' | 'monthly'>('weekly')
  const [selected, setSelected] = useState<AiServiceAnalysisResult | null>(null)
  const liveReportRef = useRef<HTMLDivElement>(null)

  const historyUrl =
    analysisType === 'weekly'
      ? `/api/services/${serviceId}/google-ads/ai/report?type=google_ads_weekly`
      : `/api/services/${serviceId}/google-ads/ai/report?type=google_ads_monthly`

  const { data: historyJson, mutate: mutateHistory } = useSWR<{ data: AiServiceAnalysisResult[] }>(
    historyUrl,
    fetcher
  )
  const history = historyJson?.data ?? []

  useEffect(() => {
    if (history.length > 0 && !selected) setSelected(history[0])
  }, [history, selected])

  const { completion, complete, isLoading, error } = useCompletion({
    api: `/api/services/${serviceId}/google-ads/ai/report`,
    streamProtocol: 'data',
    onFinish: () => {
      void mutateHistory()
    },
  })

  const handleGenerate = useCallback(() => {
    void complete('', { body: { analysisType } })
  }, [complete, analysisType])

  return (
    <div className="p-6 w-full max-w-none min-w-0 space-y-6">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href={`/projects/${projectId}/services/${serviceId}/google-ads/analytics`} className="hover:text-blue-600">
          Google 広告
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">AI分析（レポート）</span>
      </nav>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-sky-100 flex items-center justify-center text-xl">
          📣
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Google 広告</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/analytics`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          ダッシュボード
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/summary`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          サマリー
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/ai`}
          className="px-4 py-2.5 text-sm font-medium text-blue-600 border-b-2 border-blue-600 -mb-px"
        >
          AI分析
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/ai/chat`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          AIチャット
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/settings`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          設定
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
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
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="weekly">週次分析（直近7日・昨日まで）</option>
                <option value="monthly">月次分析（直近30日・昨日まで）</option>
              </select>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-blue-300 border-t-white rounded-full animate-spin" />
                ) : (
                  <span aria-hidden>✨</span>
                )}
                生成する
              </button>
            </div>

            {error ? (
              <p className="text-sm text-red-600 mt-3">
                {error instanceof Error ? error.message : '生成に失敗しました'}
              </p>
            ) : null}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">今回の出力</h2>
              {completion ? (
                <span className="text-xs text-gray-400">ストリーミング</span>
              ) : null}
            </div>
            <div ref={liveReportRef} className="prose prose-sm max-w-none">
              {completion ? (
                <>
                  <MarkdownRenderer content={completion} />
                  {isLoading ? <BlinkingCursor /> : null}
                </>
              ) : (
                <p className="text-sm text-gray-400">「生成する」を押すとここにレポートが表示されます。</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">履歴</h2>
            {history.length === 0 ? (
              <p className="text-sm text-gray-400">まだ履歴がありません</p>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setSelected(h)}
                    className={`w-full text-left px-3 py-2 rounded-xl border transition ${
                      selected?.id === h.id
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-700">
                        {h.analysis_type === 'google_ads_weekly' ? '週次' : h.analysis_type === 'google_ads_monthly' ? '月次' : h.analysis_type}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {new Date(h.created_at).toLocaleString('ja-JP')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {h.analysis_result?.slice(0, 120) ?? ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">選択中のレポート</h2>
              <div className="prose prose-sm max-w-none">
                <MarkdownRenderer content={selected.analysis_result ?? ''} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

