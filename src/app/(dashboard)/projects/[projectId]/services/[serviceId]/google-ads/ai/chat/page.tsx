'use client'

import { use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function GoogleAdsAiChatPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: any }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = svcData?.data

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/services/${serviceId}/google-ads/ai/chat`,
    }),
  })

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href={`/projects/${projectId}/services/${serviceId}/google-ads/analytics`} className="hover:text-blue-600">
          Google 広告
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">AI分析（チャット）</span>
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
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition"
        >
          AIレポート
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/ai/chat`}
          className="px-4 py-2.5 text-sm font-medium text-blue-600 border-b-2 border-blue-600 -mb-px"
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

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-sm text-gray-600">
            直近30日（昨日まで）の全体・費用上位キャンペーンを前提に、質問に答えます。
          </p>
        </div>

        <div className="p-5 space-y-3 max-h-[60vh] overflow-auto">
          {messages.length === 0 ? (
            <div className="text-sm text-gray-400">
              例: 「最近費用が増えている原因の仮説は？」「ROASを上げるために優先して見るべきキャンペーンは？」など
            </div>
          ) : null}

          {messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <div
                className={`inline-block max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 text-gray-800 border border-gray-200'
                }`}
              >
                {m.parts
                  .map((p) => (p.type === 'text' ? p.text : ''))
                  .filter(Boolean)
                  .join('')}
              </div>
            </div>
          ))}
        </div>

        {error ? (
          <div className="px-5 pb-2 text-sm text-red-600">
            {error instanceof Error ? error.message : 'チャットでエラーが発生しました'}
          </div>
        ) : null}

        <form
          className="p-5 border-t border-gray-100 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const text = String(fd.get('q') ?? '').trim()
            if (!text) return
            sendMessage({ text })
            e.currentTarget.reset()
          }}
        >
          <input
            name="q"
            placeholder={status === 'ready' ? '質問を入力…' : '送信中…'}
            disabled={status !== 'ready'}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
          />
          <button
            type="submit"
            disabled={status !== 'ready'}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-60"
          >
            送信
          </button>
        </form>
      </div>
    </div>
  )
}

