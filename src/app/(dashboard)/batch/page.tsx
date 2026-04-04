'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import type { BatchJobLog } from '@/types'

interface BatchSchedule {
  id: string
  job_name: string
  cron_expr: string
  is_enabled: boolean
  last_run_at: string | null
  description: string | null
}

const JOB_LABELS: Record<string, string> = {
  hourly_media_insight_collector: '毎時インサイト収集',
  hourly_account_insight_collector: 'アカウントインサイト収集',
  daily_media_collector: '投稿一覧同期',
  daily_token_refresh: 'トークン更新',
  kpi_calc_batch: 'KPI計算',
  weekly_ai_analysis: '週次AI分析',
  monthly_ai_analysis: '月次AI分析',
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; dot: string }> = {
  running: { bg: 'bg-blue-50',   text: 'text-blue-700',   label: '実行中', dot: 'bg-blue-500 animate-pulse' },
  success: { bg: 'bg-green-50',  text: 'text-green-700',  label: '成功',   dot: 'bg-green-500' },
  partial: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: '一部失敗', dot: 'bg-yellow-500' },
  failed:  { bg: 'bg-red-50',    text: 'text-red-700',    label: '失敗',   dot: 'bg-red-500' },
}

const BATCH_ENDPOINTS: Record<string, string> = {
  daily_media_collector: '/api/batch/media-collector',
  hourly_media_insight_collector: '/api/batch/insight-collector',
  kpi_calc_batch: '/api/batch/kpi-calc',
}

export default function BatchPage() {
  const [logs, setLogs] = useState<BatchJobLog[]>([])
  const [schedules, setSchedules] = useState<BatchSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [cronSecret, setCronSecret] = useState('')

  const fetchData = async () => {
    const res = await fetch('/api/batch/status')
    const json = await res.json()
    setLogs(json.data?.logs ?? [])
    setSchedules(json.data?.schedules ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const handleManualRun = async (endpoint: string, jobName: string) => {
    if (!cronSecret) {
      alert('CRON_SECRETを入力してください')
      return
    }
    setRunning(jobName)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean
        error?: string
        processed?: number
        failed?: number
        accounts?: number
        skipped_no_token?: number
        last_error?: string
        token_invalid?: boolean
        hint_ja?: string
      }
      if (!res.ok) {
        alert(typeof json.error === 'string' ? json.error : `失敗 (${res.status})`)
        return
      }
      const doneLine =
        json.success === false
          ? `${JOB_LABELS[jobName] ?? jobName} は終了しましたが、失敗した処理があります（HTTP は 200）。`
          : `${JOB_LABELS[jobName] ?? jobName} が完了しました。`
      const lines = [
        doneLine,
        json.hint_ja ?? null,
        json.processed != null ? `処理件数: ${json.processed}` : null,
        json.failed != null ? `失敗: ${json.failed}` : null,
        json.accounts != null ? `対象アカウント数: ${json.accounts}` : null,
        json.skipped_no_token != null && json.skipped_no_token > 0
          ? `トークンなしでスキップ: ${json.skipped_no_token}（アカウントに有効トークンを登録してください）`
          : null,
        json.last_error ? `最後のエラー: ${json.last_error}` : null,
      ].filter(Boolean)
      alert(lines.join('\n'))
    } finally {
      await fetchData()
      setRunning(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">バッチ管理</h1>
        <button onClick={fetchData} className="btn-secondary flex items-center gap-2 text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          更新
        </button>
      </div>

      {/* Manual Trigger */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">手動実行</h2>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">CRON_SECRET</label>
          <input
            type="password"
            value={cronSecret}
            onChange={e => setCronSecret(e.target.value)}
            placeholder="環境変数のCRON_SECRETを入力"
            className="input max-w-xs"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          {Object.entries(BATCH_ENDPOINTS).map(([jobName, endpoint]) => (
            <button
              key={jobName}
              onClick={() => handleManualRun(endpoint, jobName)}
              disabled={running === jobName || !cronSecret}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition disabled:opacity-50"
            >
              {running === jobName ? (
                <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {JOB_LABELS[jobName] ?? jobName}
            </button>
          ))}
        </div>
      </div>

      {/* Schedules */}
      {schedules.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">スケジュール設定</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3">ジョブ名</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Cron式</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">説明</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">最終実行</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {schedules.map(s => (
                <tr key={s.id}>
                  <td className="px-6 py-3 text-sm text-gray-700 font-medium">{JOB_LABELS[s.job_name] ?? s.job_name}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-500">{s.cron_expr}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.description ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {s.last_run_at ? new Date(s.last_run_at).toLocaleString('ja-JP') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                      s.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.is_enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {s.is_enabled ? '有効' : '無効'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Execution Log */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">実行ログ</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">実行ログがありません</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3">ジョブ</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">開始日時</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">状態</th>
                <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">処理数</th>
                <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">失敗数</th>
                <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">所要時間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map(log => {
                const style = STATUS_STYLES[log.status] ?? STATUS_STYLES.failed
                return (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-sm text-gray-700">{JOB_LABELS[log.job_name] ?? log.job_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(log.started_at).toLocaleString('ja-JP')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 text-right">{log.records_processed}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <span className={log.records_failed > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                        {log.records_failed}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-right">
                      {log.duration_ms != null ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
