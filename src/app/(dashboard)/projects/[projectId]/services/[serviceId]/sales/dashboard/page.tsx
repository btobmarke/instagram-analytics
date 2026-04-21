'use client'

import { use, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { salesHourlySlotsForRevenueSum } from '@/lib/summary/sales-slot-aggregate'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
}

interface SalesHourlySlot {
  id: string
  slot_label: string
  session_start_time: string | null
  session_end_time: string | null
  total_amount_with_tax: number | null
  total_amount_without_tax: number | null
  business_hours_minutes: number | null
  is_rest_break: boolean
  memo: string | null
}

interface SalesDay {
  id: string
  service_id: string
  sales_date: string
  session_label: string
  data_source: 'pos' | 'manual'
  memo: string | null
  sales_hourly_slots: SalesHourlySlot[] | null
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return '—'
  return `¥${amount.toLocaleString('ja-JP')}`
}

function formatTime(t: string | null): string {
  if (!t) return ''
  return t.slice(0, 5)
}

function getDateRange(offsetDays: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - offsetDays)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

export default function SalesDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [range, setRange] = useState<7 | 30 | 90>(30)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = svcData?.data

  const { from, to } = getDateRange(range)
  const { data: recordsData, isLoading } = useSWR<{ success: boolean; data: SalesDay[] }>(
    `/api/services/${serviceId}/sales/records?from=${from}&to=${to}`,
    fetcher
  )
  const days = recordsData?.data ?? []

  const { totalRevenue, totalDays, slotCount, groupedByDate } = useMemo(() => {
    let revenue = 0
    const byDate: Record<string, { day: SalesDay; slots: SalesHourlySlot[] }[]> = {}
    for (const day of days) {
      const slots = [...(day.sales_hourly_slots ?? [])].sort((a, b) =>
        a.slot_label.localeCompare(b.slot_label, 'ja')
      )
      const slotsForSum = salesHourlySlotsForRevenueSum(slots)
      for (const s of slotsForSum) {
        revenue += s.total_amount_with_tax ?? 0
      }
      if (!byDate[day.sales_date]) byDate[day.sales_date] = []
      byDate[day.sales_date].push({ day, slots })
    }
    const dates = Object.keys(byDate)
    return {
      totalRevenue: revenue,
      totalDays: dates.length,
      slotCount: days.reduce((n, d) => n + (d.sales_hourly_slots?.length ?? 0), 0),
      groupedByDate: byDate,
    }
  }, [days])

  const avgDaily = totalDays > 0 ? Math.round(totalRevenue / totalDays) : 0
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a))

  const tabs = [
    { href: `/projects/${projectId}/services/${serviceId}/sales/dashboard`, label: 'ダッシュボード', active: true },
    { href: `/projects/${projectId}/services/${serviceId}/sales/records`, label: '売上登録', active: false },
    { href: `/projects/${projectId}/services/${serviceId}/sales/products`, label: '商品マスタ', active: false },
    { href: `/projects/${projectId}/services/${serviceId}/summary`, label: 'サマリー', active: false },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/projects" className="hover:text-amber-600">プロジェクト</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-amber-600">
          {service?.project.project_name ?? '...'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">{service?.service_name ?? '...'}</span>
        <span>›</span>
        <span className="text-gray-500">ダッシュボード</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-yellow-100 flex items-center justify-center text-xl">
          💰
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">売上分析</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

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

      <div className="flex items-center gap-2 mb-6">
        <span className="text-sm text-gray-500">表示期間:</span>
        {([7, 30, 90] as const).map(d => (
          <button
            key={d}
            type="button"
            onClick={() => setRange(d)}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition ${
              range === d
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
            }`}
          >
            直近{d}日
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <KpiCard
          label={`合計売上（直近${range}日）`}
          value={formatCurrency(totalRevenue)}
          sub={`時間帯 ${slotCount} 行`}
          color="amber"
        />
        <KpiCard
          label="営業日数"
          value={`${totalDays}日`}
          sub={`${from} 〜 ${to}`}
          color="orange"
        />
        <KpiCard
          label="1日平均売上"
          value={formatCurrency(avgDaily)}
          sub="税込（時間帯合計ベース）"
          color="yellow"
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">
            売上履歴
            <span className="ml-2 text-sm font-normal text-gray-400">{sortedDates.length}日分</span>
          </h2>
          <Link
            href={`/projects/${projectId}/services/${serviceId}/sales/records`}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            売上を登録
          </Link>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">読み込み中...</div>
        ) : sortedDates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-sm mb-2">まだ売上データがありません</p>
            <Link
              href={`/projects/${projectId}/services/${serviceId}/sales/records`}
              className="text-amber-600 text-sm font-medium hover:underline"
            >
              最初の売上を登録する →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {sortedDates.map(date => {
              const blocks = groupedByDate[date]
              const dayTotal = blocks.reduce((sum, { slots }) => {
                const forSum = salesHourlySlotsForRevenueSum(slots)
                return sum + forSum.reduce((s, sl) => s + (sl.total_amount_with_tax ?? 0), 0)
              }, 0)
              return (
                <div key={date} className="px-6 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-800">
                      {new Date(date + 'T00:00:00').toLocaleDateString('ja-JP', {
                        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
                      })}
                    </span>
                    <span className="text-sm font-bold text-amber-600">{formatCurrency(dayTotal)}</span>
                  </div>
                  <div className="space-y-3">
                    {blocks.map(({ day, slots }) => (
                      <div key={day.id} className="pl-2 border-l-2 border-amber-100">
                        <div className="text-xs text-gray-500 mb-1">
                          <span className="font-medium text-gray-700">締め: {day.session_label}</span>
                          <span className={`ml-2 px-1.5 py-0.5 rounded-full font-medium ${
                            day.data_source === 'pos' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {day.data_source === 'pos' ? 'POS' : '手動'}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {slots.map(slot => (
                            <div key={slot.id} className="flex items-center gap-3 text-xs text-gray-500 pl-2">
                              <span className="font-medium text-gray-700">{slot.slot_label}</span>
                              {slot.session_start_time && (
                                <span>
                                  {formatTime(slot.session_start_time)}
                                  {slot.session_end_time ? ` 〜 ${formatTime(slot.session_end_time)}` : ''}
                                </span>
                              )}
                              {slot.is_rest_break && (
                                <span className="text-violet-600">休憩</span>
                              )}
                              <span className="ml-auto font-semibold text-gray-800">
                                {formatCurrency(slot.total_amount_with_tax)}
                              </span>
                              {slot.business_hours_minutes != null && slot.business_hours_minutes > 0 && (
                                <span className="text-gray-400">{slot.business_hours_minutes}分</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color: 'amber' | 'orange' | 'yellow'
}) {
  const colorMap = {
    amber: 'from-amber-50 to-yellow-50 border-amber-100',
    orange: 'from-orange-50 to-amber-50 border-orange-100',
    yellow: 'from-yellow-50 to-orange-50 border-yellow-100',
  }
  return (
    <div className={`bg-gradient-to-br ${colorMap[color]} rounded-2xl border p-5`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mb-1">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}
