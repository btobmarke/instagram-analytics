'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

// TODO(phase2): 注文データが揃う場合は、夜間の注文集計バッチで時間帯別および日次の売上レコードを自動登録する（手動の時間帯別登録と整合させる設計が必要）。

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
  const [showForm, setShowForm] = useState<'single' | 'hourly' | false>(false)

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
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowForm('single')}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                売上を追加
              </button>
              <button
                type="button"
                onClick={() => setShowForm('hourly')}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-violet-700 border border-violet-300 rounded-lg hover:bg-violet-50 transition"
              >
                時間帯別登録
              </button>
            </div>
          )}
        </div>

        {showForm === 'single' && (
          <div className="px-6 py-5 border-b border-gray-100 bg-amber-50">
            <SalesRecordForm
              serviceId={serviceId}
              onClose={() => setShowForm(false)}
              onSaved={() => { setShowForm(false); mutate() }}
            />
          </div>
        )}
        {showForm === 'hourly' && (
          <div className="px-6 py-5 border-b border-gray-100 bg-violet-50">
            <HourlySalesBatchForm
              serviceId={serviceId}
              onClose={() => setShowForm(false)}
              onSaved={() => { setShowForm(false); mutate() }}
            />
          </div>
        )}

        {records.length === 0 && !showForm ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-sm mb-2">売上データがありません</p>
            <div className="flex flex-col sm:flex-row gap-2 items-center">
              <button type="button" onClick={() => setShowForm('single')} className="text-amber-600 text-sm font-medium hover:underline">
                最初の売上を登録する
              </button>
              <span className="text-gray-300 hidden sm:inline">|</span>
              <button type="button" onClick={() => setShowForm('hourly')} className="text-violet-600 text-sm font-medium hover:underline">
                時間帯別に登録する
              </button>
            </div>
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

type HourlyRow = {
  id: string
  startTime: string
  endTime: string
  withTax: string
  withoutTax: string
  isRestBreak: boolean
}

function newRowId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `r-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** "HH:MM" または "HH:MM:SS" を分に変換 */
function parseTimeToMinutes(t: string): number | null {
  const s = t.trim().slice(0, 8)
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function minutesToTimeInputValue(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** DB の TIME 用（秒付き） */
function toDbTime(hhmm: string): string {
  const base = hhmm.trim().slice(0, 5)
  return /^\d{2}:\d{2}$/.test(base) ? `${base}:00` : base
}

function expandHourlySlots(startMin: number, endMin: number): { startMin: number; endMin: number }[] {
  if (endMin <= startMin) return []
  const slots: { startMin: number; endMin: number }[] = []
  let cur = startMin
  while (cur < endMin) {
    const next = Math.min(cur + 60, endMin)
    slots.push({ startMin: cur, endMin: next })
    cur = next
  }
  return slots
}

// ---------- 時間帯別まとめ登録 ----------
function HourlySalesBatchForm({
  serviceId,
  onClose,
  onSaved,
}: {
  serviceId: string
  onClose: () => void
  onSaved: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [salesDate, setSalesDate] = useState(today)
  const [rangeStart, setRangeStart] = useState('10:00')
  const [rangeEnd, setRangeEnd] = useState('12:00')
  const [dataSource, setDataSource] = useState<'pos' | 'manual'>('manual')
  const [sharedMemo, setSharedMemo] = useState('')
  const [rows, setRows] = useState<HourlyRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const applyRestToRow = (r: HourlyRow): HourlyRow =>
    r.isRestBreak ? { ...r, withTax: '', withoutTax: '' } : r

  const generateRows = () => {
    const a = parseTimeToMinutes(rangeStart)
    const b = parseTimeToMinutes(rangeEnd)
    if (a == null || b == null) {
      setError('開始・終了時刻を正しく入力してください')
      return
    }
    if (b <= a) {
      setError('終了時刻は開始時刻より後である必要があります')
      return
    }
    setError('')
    const slots = expandHourlySlots(a, b)
    setRows(
      slots.map(({ startMin, endMin }) => ({
        id: newRowId(),
        startTime: minutesToTimeInputValue(startMin),
        endTime: minutesToTimeInputValue(endMin),
        withTax: '',
        withoutTax: '',
        isRestBreak: false,
      }))
    )
  }

  const addRow = () => {
    setRows(prev => [
      ...prev,
      {
        id: newRowId(),
        startTime: '12:00',
        endTime: '13:00',
        withTax: '',
        withoutTax: '',
        isRestBreak: false,
      },
    ])
  }

  const removeRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  const updateRow = (id: string, patch: Partial<HourlyRow>) => {
    setRows(prev =>
      prev.map(r => {
        if (r.id !== id) return r
        const next = { ...r, ...patch }
        return applyRestToRow(next)
      })
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!salesDate) {
      setError('売上日を入力してください')
      return
    }
    if (rows.length === 0) {
      setError('時間帯行がありません。「時間帯を生成」で追加するか、行を追加してください')
      return
    }

    for (const r of rows) {
      const sm = parseTimeToMinutes(r.startTime)
      const em = parseTimeToMinutes(r.endTime)
      if (sm == null || em == null) {
        setError('各時間帯の開始・終了を正しく入力してください')
        return
      }
      if (em <= sm) {
        setError(`終了は開始より後である必要があります（${r.startTime} 〜 ${r.endTime}）`)
        return
      }
    }

    setSaving(true)
    setError('')

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const sm = parseTimeToMinutes(r.startTime)!
      const em = parseTimeToMinutes(r.endTime)!
      const sessionLabel = `時間帯:${minutesToTimeInputValue(sm)}-${minutesToTimeInputValue(em)}`
      const withTax = r.isRestBreak ? 0 : r.withTax ? Number(r.withTax) : null
      const withoutTax = r.isRestBreak ? 0 : r.withoutTax ? Number(r.withoutTax) : null
      const memoParts = [r.isRestBreak ? '休憩時間' : null, sharedMemo.trim() || null].filter(Boolean)
      const memo = memoParts.length ? memoParts.join(' / ') : null

      const res = await fetch(`/api/services/${serviceId}/sales/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales_date: salesDate,
          session_label: sessionLabel,
          session_start_time: toDbTime(r.startTime),
          session_end_time: toDbTime(r.endTime),
          data_source: dataSource,
          total_amount_with_tax: withTax,
          total_amount_without_tax: withoutTax,
          business_hours_minutes: em - sm,
          memo,
        }),
      })
      const json = await res.json()
      if (!json.success) {
        setSaving(false)
        setError(
          json.error?.message
            ? `${i + 1}行目（${sessionLabel}）: ${json.error.message}`
            : `${i + 1}行目の保存に失敗しました`
        )
        return
      }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm font-semibold text-gray-800">時間帯別に売上をまとめて登録</p>
      <p className="text-xs text-gray-600 leading-relaxed">
        各行は「売上日」と異なる <span className="font-medium">締め区分（自動）</span>で保存されます（例: 時間帯:10:00-11:00）。
        休憩にチェックを入れると税込・税抜は 0 円で登録されます。
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2 md:col-span-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">売上日 <span className="text-red-500">*</span></label>
          <input
            type="date"
            value={salesDate}
            onChange={e => setSalesDate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">枠の開始</label>
          <input
            type="time"
            value={rangeStart}
            onChange={e => setRangeStart(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">枠の終了</label>
          <input
            type="time"
            value={rangeEnd}
            onChange={e => setRangeEnd(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={generateRows}
            className="w-full px-3 py-2 text-sm font-medium text-violet-800 bg-white border border-violet-300 rounded-lg hover:bg-violet-100 transition"
          >
            時間帯を生成（1時間刻み）
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">データソース</label>
          <select
            value={dataSource}
            onChange={e => setDataSource(e.target.value as 'pos' | 'manual')}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          >
            <option value="pos">POS（注文データあり）</option>
            <option value="manual">手動（商品出数のみ）</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">共通メモ（任意・各行に付与）</label>
          <input
            type="text"
            value={sharedMemo}
            onChange={e => setSharedMemo(e.target.value)}
            placeholder="例: 店内集計"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          className="px-3 py-1.5 text-xs font-medium text-violet-700 border border-violet-300 rounded-lg hover:bg-violet-100 bg-white transition"
        >
          行を追加
        </button>
        <span className="text-xs text-gray-500">開始・終了は各行で編集できます</span>
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-violet-200 bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-medium whitespace-nowrap">開始</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">終了</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">税込</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">税抜</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">休憩</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      value={r.startTime}
                      onChange={e => updateRow(r.id, { startTime: e.target.value })}
                      className="w-full min-w-[6.5rem] px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      value={r.endTime}
                      onChange={e => updateRow(r.id, { endTime: e.target.value })}
                      className="w-full min-w-[6.5rem] px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      disabled={r.isRestBreak}
                      value={r.withTax}
                      onChange={e => updateRow(r.id, { withTax: e.target.value })}
                      placeholder="0"
                      className="w-full min-w-[5rem] px-2 py-1.5 text-xs border border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      disabled={r.isRestBreak}
                      value={r.withoutTax}
                      onChange={e => updateRow(r.id, { withoutTax: e.target.value })}
                      placeholder="0"
                      className="w-full min-w-[5rem] px-2 py-1.5 text-xs border border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={r.isRestBreak}
                      onChange={e => updateRow(r.id, { isRestBreak: e.target.checked })}
                      title="休憩時間（0円で登録）"
                      className="rounded border-gray-300 text-violet-600 focus:ring-violet-300"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      className="text-xs text-gray-400 hover:text-red-500 whitespace-nowrap"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 bg-white"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={saving || rows.length === 0}
          className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-60 transition"
        >
          {saving ? '保存中...' : 'まとめて登録'}
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
