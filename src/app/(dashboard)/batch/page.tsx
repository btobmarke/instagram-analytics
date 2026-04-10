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

// -----------------------------------------------------------------------
// バッチメタ情報（カテゴリ・説明・頻度）
// -----------------------------------------------------------------------
type Category = 'Instagram' | 'LP / MA' | 'GA4' | 'Clarity' | 'GBP' | 'LINE OAM' | 'Google 広告' | 'システム'

interface JobMeta {
  label: string
  description: string
  category: Category
  frequency: string
}

const CATEGORY_STYLE: Record<Category, { bg: string; text: string; dot: string }> = {
  Instagram: { bg: 'bg-pink-100',   text: 'text-pink-700',   dot: 'bg-pink-400' },
  'LP / MA': { bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-400' },
  GA4:       { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-400' },
  Clarity:   { bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-400' },
  GBP:       { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  'LINE OAM': { bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-400' },
  'Google 広告': { bg: 'bg-sky-100', text: 'text-sky-800', dot: 'bg-sky-500' },
  システム:  { bg: 'bg-gray-100',   text: 'text-gray-600',   dot: 'bg-gray-400' },
}

const JOB_META: Record<string, JobMeta> = {
  daily_media_collector: {
    label: '投稿一覧同期',
    description: 'フィード・リール・ストーリーの新規投稿を取得しDBに保存',
    category: 'Instagram',
    frequency: '毎時',
  },
  hourly_media_insight_collector: {
    label: 'インサイト収集',
    description: '投稿ごとのリーチ・いいね・保存・コメント数を取得',
    category: 'Instagram',
    frequency: '毎時',
  },
  hourly_account_insight_collector: {
    label: 'アカウントインサイト収集',
    description: 'アカウント全体のフォロワー数・リーチ・PV等を取得',
    category: 'Instagram',
    frequency: '毎日',
  },
  daily_token_refresh: {
    label: 'トークン更新',
    description: 'Instagram Long-Lived Token（有効期限60日）を自動更新',
    category: 'システム',
    frequency: '毎日',
  },
  kpi_calc_batch: {
    label: 'KPI計算',
    description: 'インサイトデータからエンゲージメント率・リーチ率等のKPIを再計算',
    category: 'Instagram',
    frequency: '毎時',
  },
  weekly_ai_analysis: {
    label: '週次AI分析',
    description: 'Claude によるInstagram投稿の週次パフォーマンス分析とコメント生成',
    category: 'Instagram',
    frequency: '毎週月曜',
  },
  monthly_ai_analysis: {
    label: '月次AI分析',
    description: 'Claude による月次トレンド分析・改善提案レポート生成',
    category: 'Instagram',
    frequency: '毎月1日',
  },
  lp_aggregate: {
    label: 'LP 集計',
    description: 'LPのセッション・ユーザー・HOT率等を集計してサマリーテーブルを更新',
    category: 'LP / MA',
    frequency: '毎時',
  },
  ga4_collector: {
    label: 'データ収集',
    description: 'GA4 Data API からセッション・PV・CV・トラフィックソース・デバイス・地域データを取得',
    category: 'GA4',
    frequency: '毎日',
  },
  clarity_collector: {
    label: 'データ収集',
    description: 'Clarity Export API からセッション・スクロール深度・レイジクリック・JS エラーを取得',
    category: 'Clarity',
    frequency: '毎日',
  },
  gbp_daily: {
    label: 'GBP日次データ収集',
    description: 'GBP Performance API からインプレッション・アクション指標を取得し、レビューを同期',
    category: 'GBP',
    frequency: '毎日',
  },
  line_oam_daily: {
    label: 'LINE OAM日次データ収集',
    description: 'LINE OAM からフレンド数・属性・ショップカード・リワードカード取引履歴を取得',
    category: 'LINE OAM',
    frequency: '毎日',
  },
  google_ads_daily: {
    label: 'Google 広告 日次収集',
    description: 'Google Ads API からキャンペーン・広告グループ・キーワード（ON時）の日次指標を取得',
    category: 'Google 広告',
    frequency: '毎日',
  },
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; dot: string }> = {
  running: { bg: 'bg-blue-50',   text: 'text-blue-700',   label: '実行中',   dot: 'bg-blue-500 animate-pulse' },
  success: { bg: 'bg-green-50',  text: 'text-green-700',  label: '成功',     dot: 'bg-green-500' },
  partial: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: '一部失敗', dot: 'bg-yellow-500' },
  failed:  { bg: 'bg-red-50',    text: 'text-red-700',    label: '失敗',     dot: 'bg-red-500' },
}

const BATCH_ENDPOINTS: Record<string, string> = {
  daily_media_collector:          '/api/batch/media-collector',
  hourly_media_insight_collector: '/api/batch/insight-collector',
  kpi_calc_batch:                 '/api/batch/kpi-calc',
  lp_aggregate:                   '/api/batch/lp-aggregate',
  ga4_collector:                  '/api/batch/ga4-collector',
  clarity_collector:              '/api/batch/clarity-collector',
  gbp_daily:                      '/api/batch/gbp-daily',
  line_oam_daily:                 '/api/batch/line-oam-daily',
  google_ads_daily:               '/api/batch/google-ads-daily',
}

const BATCH_GROUPS: { category: Category; jobs: string[] }[] = [
  { category: 'Instagram', jobs: ['daily_media_collector', 'hourly_media_insight_collector', 'kpi_calc_batch'] },
  { category: 'LP / MA',   jobs: ['lp_aggregate'] },
  { category: 'GA4',       jobs: ['ga4_collector'] },
  { category: 'Clarity',   jobs: ['clarity_collector'] },
  { category: 'GBP',       jobs: ['gbp_daily'] },
  { category: 'LINE OAM', jobs: ['line_oam_daily'] },
  { category: 'Google 広告', jobs: ['google_ads_daily'] },
]

// -----------------------------------------------------------------------
// カテゴリバッジ
// -----------------------------------------------------------------------
function CategoryBadge({ category }: { category: Category }) {
  const s = CATEGORY_STYLE[category]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {category}
    </span>
  )
}

// -----------------------------------------------------------------------
// ジョブ名 + カテゴリ（ログ・スケジュール共通セル）
// -----------------------------------------------------------------------
function JobCell({ jobName }: { jobName: string }) {
  const meta = JOB_META[jobName]
  if (!meta) {
    return <span className="text-sm text-gray-700 font-medium">{jobName}</span>
  }
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <CategoryBadge category={meta.category} />
        <span className="text-sm font-medium text-gray-900">{meta.label}</span>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">{meta.description}</p>
    </div>
  )
}

// -----------------------------------------------------------------------
// メインページ
// -----------------------------------------------------------------------
export default function BatchPage() {
  const [logs, setLogs] = useState<BatchJobLog[]>([])
  const [schedules, setSchedules] = useState<BatchSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [cronSecret, setCronSecret] = useState('')
  const [logFilter, setLogFilter] = useState<Category | 'すべて'>('すべて')

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
        error?: string | { message?: string; code?: string }
        processed?: number
        failed?: number
        errors?: number
        accounts?: number
        skipped_no_token?: number
        last_error?: string
        hint_ja?: string
        target_date?: string
        batch_run_id?: string
        status?: string
        data?: {
          targetDate?: string
          processedServices?: number
          okCount?: number
          errorCount?: number
          results?: Array<{ status: string; error?: string; serviceId?: string }>
        }
      }
      const errMsg =
        typeof json.error === 'string'
          ? json.error
          : json.error?.message

      if (!res.ok) {
        alert(errMsg ?? `失敗 (${res.status})`)
        return
      }

      // GA4/Clarity 等: HTTP 200 でも success:false（連携0件・全件失敗・DB upsert 失敗）
      if (json.success === false) {
        const resultErrors =
          json.data?.results
            ?.filter((r) => r.status === 'error')
            .map((r) => `${r.serviceId ?? '?'}: ${r.error ?? 'error'}`)
            .join('\n') ?? ''
        alert(
          [
            errMsg ?? 'バッチは完了しませんでした。',
            json.hint_ja,
            json.data?.targetDate != null ? `対象日: ${json.data.targetDate}` : null,
            json.data?.processedServices != null
              ? `連携サービス数: ${json.data.processedServices}`
              : null,
            resultErrors ? `各サービス:\n${resultErrors}` : null,
          ]
            .filter(Boolean)
            .join('\n\n')
        )
        return
      }

      const meta = JOB_META[jobName]
      const label = meta ? `[${meta.category}] ${meta.label}` : jobName
      const doneLine = `${label} が完了しました。`
      const lines = [
        doneLine,
        json.hint_ja ?? null,
        json.target_date != null ? `対象日: ${json.target_date}` : null,
        json.data?.targetDate != null ? `対象日: ${json.data.targetDate}` : null,
        json.data?.okCount != null && json.data?.errorCount != null
          ? `成功サービス: ${json.data.okCount} / 失敗: ${json.data.errorCount}`
          : null,
        json.processed != null ? `処理サイト数: ${json.processed}` : null,
        json.errors != null && json.errors > 0 ? `エラー件数: ${json.errors}` : null,
        json.failed != null ? `失敗: ${json.failed}` : null,
        json.accounts != null ? `対象アカウント数: ${json.accounts}` : null,
        json.skipped_no_token != null && json.skipped_no_token > 0
          ? `トークンなしでスキップ: ${json.skipped_no_token}`
          : null,
        json.last_error ? `最後のエラー: ${json.last_error}` : null,
        json.status != null ? `ステータス: ${json.status}` : null,
      ].filter(Boolean)
      const errList = (json as { errors?: Array<{ serviceId?: string; error?: string }> }).errors
      if (Array.isArray(errList) && errList.length > 0) {
        lines.push('【一部失敗】')
        for (const e of errList) {
          lines.push(`${e.serviceId ?? '?'}: ${e.error ?? ''}`)
        }
      }
      alert(lines.join('\n'))
    } finally {
      await fetchData()
      setRunning(null)
    }
  }

  const LOG_CATEGORIES: (Category | 'すべて')[] = ['すべて', 'Instagram', 'LP / MA', 'GA4', 'Clarity', 'GBP', 'LINE OAM', 'Google 広告', 'システム']
  const filteredLogs = logFilter === 'すべて'
    ? logs
    : logs.filter(l => JOB_META[l.job_name]?.category === logFilter)

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">バッチ管理</h1>
          <p className="text-sm text-gray-500 mt-1">各媒体のデータ収集・集計バッチを管理します</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          更新
        </button>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 手動実行                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">手動実行</h2>
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 mb-1">CRON_SECRET</label>
          <input
            type="password"
            value={cronSecret}
            onChange={e => setCronSecret(e.target.value)}
            placeholder=".env の CRON_SECRET（旧 BATCH_SECRET も可）"
            className="w-72 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
        </div>
        <div className="space-y-4">
          {BATCH_GROUPS.map(group => {
            const catStyle = CATEGORY_STYLE[group.category]
            return (
              <div key={group.category} className="flex items-start gap-4">
                <div className="w-24 pt-1 flex-shrink-0">
                  <CategoryBadge category={group.category} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.jobs.map(jobName => {
                    const endpoint = BATCH_ENDPOINTS[jobName]
                    const meta = JOB_META[jobName]
                    if (!endpoint || !meta) return null
                    const isRunning = running === jobName
                    return (
                      <button
                        key={jobName}
                        onClick={() => handleManualRun(endpoint, jobName)}
                        disabled={isRunning || !cronSecret}
                        title={meta.description}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition disabled:opacity-50"
                      >
                        {isRunning ? (
                          <div className={`w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin`} />
                        ) : (
                          <svg className={`w-3.5 h-3.5 ${catStyle.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                        {meta.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* スケジュール設定                                                  */}
      {/* ---------------------------------------------------------------- */}
      {schedules.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">スケジュール設定</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 w-2/5">媒体 / バッチ名</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">頻度</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Cron 式</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">最終実行</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {schedules.map(s => {
                const meta = JOB_META[s.job_name]
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <JobCell jobName={s.job_name} />
                    </td>
                    <td className="px-4 py-4 text-xs text-gray-500 whitespace-nowrap">
                      {meta?.frequency ?? '—'}
                    </td>
                    <td className="px-4 py-4 text-xs font-mono text-gray-400">{s.cron_expr}</td>
                    <td className="px-4 py-4 text-xs text-gray-500">
                      {s.last_run_at ? new Date(s.last_run_at).toLocaleString('ja-JP') : '—'}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                        s.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.is_enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {s.is_enabled ? '有効' : '無効'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* 実行ログ                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">実行ログ</h2>
          {/* カテゴリフィルター */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {LOG_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setLogFilter(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  logFilter === cat
                    ? cat === 'すべて'
                      ? 'bg-gray-800 text-white'
                      : `${CATEGORY_STYLE[cat as Category].bg} ${CATEGORY_STYLE[cat as Category].text}`
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">実行ログがありません</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 w-2/5">媒体 / バッチ名</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">開始日時</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">状態</th>
                <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">処理数</th>
                <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">失敗数</th>
                <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">所要時間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredLogs.map(log => {
                const style = STATUS_STYLES[log.status] ?? STATUS_STYLES.failed
                return (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <JobCell jobName={log.job_name} />
                    </td>
                    <td className="px-4 py-4 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(log.started_at).toLocaleString('ja-JP')}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-700 text-right">{log.records_processed}</td>
                    <td className="px-4 py-4 text-sm text-right">
                      <span className={log.records_failed > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                        {log.records_failed}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500 text-right">
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
