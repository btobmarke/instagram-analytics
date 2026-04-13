'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
}

interface SalesRecord {
  id: string
  sales_date: string
  session_label: string
  session_start_time: string | null
  session_end_time: string | null
  data_source: 'pos' | 'manual'
  total_amount_with_tax: number | null
  total_amount_without_tax: number | null
  business_hours_minutes: number | null
  memo: string | null
}

export default function SalesRecordsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [showForm, setShowForm] = useState(false)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = svcData?.data

  // 直近90日分を表示
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const { data: recordsData, mutate } = useSWR<{ success: boolean; data: SalesRecord[] }>(
    `/api/services/${serviceId}/sales/records?from=${from}&to=${to}`,
    fetcher
  )
  const records = recordsData?.data ?? []

  const tabs = [
    { href: `/projects/${projectId}/services/${serviceId}/sales/dashboard`, label: 'ダッシュボード', active: false },
    { href: `/projects/${projectId}/services/${serviceId}/sales/records`, label: '売上登録', active: true },
    { href: `/projects/${projectId}/services/${serviceId}/sales/products`, label: '商品マスタ', active: false },
    { href: `/projects/${projectId}/services/${serviceId}/summary`, label: 'サマリー', active: false },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/projects" className="hover:text-amber-600">プロジェクト</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-amber-600">
          {service?.project.project_name ?? '...'}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/sales/dashboard`} className="hover:text-amber-600">
          {service?.service_name ?? '...'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">売上登録</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-yellow-100 flex items-center justify-center text-xl">💰</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">売上登録</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      {/* タブ */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        {tabs.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
              tab.active
                ? 'text-amber-600 border-amber-500'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">
            売上データ
            <span className="ml-2 text-sm font-normal text-gray-400">直近90日 / {records.length}件</span>
          </h2>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              売上を追加
            </button>
          )}
        </div>

        {showForm && (
          <div className="px-6 py-5 border-b border-gray-100 bg-amber-50">
            <SalesRecordForm
              serviceId={serviceId}
              onClose={() => setShowForm(false)}
              onSaved={() => { setShowForm(false); mutate() }}
            />
          </div>
        )}

        {records.length === 0 && !showForm ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-sm mb-2">売上データがありません</p>
            <button onClick={() => setShowForm(true)} className="text-amber-600 text-sm font-medium hover:underline">
              最初の売上を登録する
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {records.map(record => (
              <RecordRow
                key={record.id}
                record={record}
                serviceId={serviceId}
                onDeleted={() => mutate()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- 売上登録フォーム ----------
function SalesRecordForm({
  serviceId,
  onClose,
  onSaved,
}: {
  serviceId: string
  onClose: () => void
  onSaved: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [salesDate, setSalesDate]                       = useState(today)
  const [sessionLabel, setSessionLabel]                 = useState('all')
  const [sessionStartTime, setSessionStartTime]         = useState('')
  const [sessionEndTime, setSessionEndTime]             = useState('')
  const [dataSource, setDataSource]                     = useState<'pos' | 'manual'>('pos')
  const [totalAmountWithTax, setTotalAmountWithTax]     = useState('')
  const [totalAmountWithoutTax, setTotalAmountWithoutTax] = useState('')
  const [businessHoursMinutes, setBusinessHoursMinutes] = useState('')
  const [memo, setMemo]                                 = useState('')
  const [saving, setSaving]                             = useState(false)
  const [error, setError]                               = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!salesDate) { setError('売上日を入力してください'); return }
    if (!sessionLabel.trim()) { setError('締め区分を入力してください'); return }

    setSaving(true)
    setError('')
    const res = await fetch(`/api/services/${serviceId}/sales/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sales_date: salesDate,
        session_label: sessionLabel.trim(),
        session_start_time: sessionStartTime || null,
        session_end_time: sessionEndTime || null,
        data_source: dataSource,
        total_amount_with_tax: totalAmountWithTax ? Number(totalAmountWithTax) : null,
        total_amount_without_tax: totalAmountWithoutTax ? Number(totalAmountWithoutTax) : null,
        business_hours_minutes: businessHoursMinutes ? Number(businessHoursMinutes) : null,
        memo: memo || null,
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (!json.success) { setError(json.error?.message ?? '保存に失敗しました'); return }
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm font-semibold text-gray-700">売上データを追加</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2 md:col-span-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">売上日 <span className="text-red-500">*</span></label>
          <input type="date" value={salesDate} onChange={e => setSalesDate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">締め区分 <span className="text-red-500">*</span></label>
          <input type="text" value={sessionLabel} onChange={e => setSessionLabel(e.target.value)}
            placeholder="例: all, 第1部"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">開始時刻</label>
          <input type="time" value={sessionStartTime} onChange={e => setSessionStartTime(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">終了時刻</label>
          <input type="time" value={sessionEndTime} onChange={e => setSessionEndTime(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">データソース</label>
          <select value={dataSource} onChange={e => setDataSource(e.target.value as 'pos' | 'manual')}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300">
            <option value="pos">POS（注文データあり）</option>
            <option value="manual">手動（商品出数のみ）</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">売上金額（税込）</label>
          <input type="number" value={totalAmountWithTax} onChange={e => setTotalAmountWithTax(e.target.value)}
            placeholder="例: 50000" min="0"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">売上金額（税抜）</label>
          <input type="number" value={totalAmountWithoutTax} onChange={e => setTotalAmountWithoutTax(e.target.value)}
            placeholder="例: 45455" min="0"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">営業時間（分）</label>
          <input type="number" value={businessHoursMinutes} onChange={e => setBusinessHoursMinutes(e.target.value)}
            placeholder="例: 180" min="0"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">メモ</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
          placeholder="備考（任意）"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
          キャンセル
        </button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-60 transition">
          {saving ? '保存中...' : '追加'}
        </button>
      </div>
    </form>
  )
}

// ---------- 売上行 ----------
function RecordRow({
  record,
  serviceId,
  onDeleted,
}: {
  record: SalesRecord
  serviceId: string
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm(`${record.sales_date} / ${record.session_label} の売上データを削除しますか？\n※関連する注文データも削除されます`)) return
    setDeleting(true)
    await fetch(`/api/services/${serviceId}/sales/records?id=${record.id}`, { method: 'DELETE' })
    setDeleting(false)
    onDeleted()
  }

  return (
    <div className="px-6 py-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-semibold text-gray-800">
            {new Date(record.sales_date + 'T00:00:00').toLocaleDateString('ja-JP', {
              year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
            })}
          </span>
          <span className="text-sm text-gray-600">/ {record.session_label}</span>
          {record.session_start_time && (
            <span className="text-xs text-gray-400">
              {formatTime(record.session_start_time)}
              {record.session_end_time ? ` 〜 ${formatTime(record.session_end_time)}` : ''}
            </span>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
            record.data_source === 'pos'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {record.data_source === 'pos' ? 'POS' : '手動'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>税込: <strong className="text-amber-600 text-sm">{record.total_amount_with_tax != null ? `¥${record.total_amount_with_tax.toLocaleString('ja-JP')}` : '—'}</strong></span>
          {record.total_amount_without_tax != null && (
            <span>税抜: ¥{record.total_amount_without_tax.toLocaleString('ja-JP')}</span>
          )}
          {record.business_hours_minutes != null && (
            <span>営業: {record.business_hours_minutes}分</span>
          )}
        </div>
        {record.memo && <p className="text-xs text-gray-400 mt-0.5">{record.memo}</p>}
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="text-xs text-gray-400 hover:text-red-500 transition disabled:opacity-60 flex-shrink-0"
      >
        削除
      </button>
    </div>
  )
}

function formatTime(t: string | null) {
  return t ? t.slice(0, 5) : ''
}
