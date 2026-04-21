'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  service_type: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
}

interface SummaryRow {
  date: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  conversionValue: number
  roas: number | null
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatYen(v: number): string {
  return v.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}

export default function GoogleAdsAnalyticsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = svcData?.data

  const [days, setDays] = useState(30)
  const { start, end } = useMemo(() => {
    const e = new Date()
    const s = new Date()
    s.setDate(s.getDate() - (days - 1))
    return { start: ymd(s), end: ymd(e) }
  }, [days])

  const { data: summaryJson, isLoading: summaryLoading } = useSWR<{
    success: boolean
    data: {
      impressions: number
      clicks: number
      cost: number
      conversions: number
      conversionValue: number
      roas: number | null
      daily: SummaryRow[]
    }
  }>(`/api/services/${serviceId}/google-ads/summary?start=${start}&end=${end}`, fetcher)

  const summary = summaryJson?.data
  const daily = summary?.daily ?? []

  const [activeCampaignId, setActiveCampaignId] = useState<string>('')
  const { data: campaignsJson } = useSWR<{ success: boolean; data: Array<any> }>(
    `/api/services/${serviceId}/google-ads/campaigns`,
    fetcher
  )
  const campaigns = campaignsJson?.data ?? []

  useEffect(() => {
    if (campaigns.length === 0) {
      if (activeCampaignId) setActiveCampaignId('')
      return
    }
    const ids = new Set(campaigns.map((c) => String(c.campaign_id)))
    if (!activeCampaignId || !ids.has(activeCampaignId)) {
      setActiveCampaignId(String(campaigns[0].campaign_id))
    }
  }, [activeCampaignId, campaigns])

  const { data: adGroupsJson } = useSWR<{ success: boolean; data: Array<any> }>(
    activeCampaignId ? `/api/services/${serviceId}/google-ads/ad-groups?campaignId=${activeCampaignId}` : null,
    fetcher
  )
  const adGroups = adGroupsJson?.data ?? []

  return (
    <div className="p-6 w-full max-w-none min-w-0">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/clients" className="hover:text-blue-600">
          クライアント一覧
        </Link>
        <span>›</span>
        <Link href={`/clients/${service?.client.id}`} className="hover:text-blue-600">
          {service?.client.client_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-blue-600">
          {service?.project.project_name}
        </Link>
        <span>›</span>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/integrations`}
          className="hover:text-blue-600"
        >
          {service?.service_name ?? 'Google 広告'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">ダッシュボード</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-sky-100 flex items-center justify-center text-xl">
          📣
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Google 広告</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/google-ads/analytics`}
          className="px-4 py-2.5 text-sm font-medium text-blue-600 border-b-2 border-blue-600 -mb-px"
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

      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">期間</p>
            <p className="text-sm text-gray-700 mt-1">
              {start} 〜 {end}
            </p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition ${
                  days === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                直近{d}日
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <KpiCard label="表示回数" value={summary?.impressions?.toLocaleString() ?? '—'} />
        <KpiCard label="クリック" value={summary?.clicks?.toLocaleString() ?? '—'} />
        <KpiCard label="費用" value={summary ? formatYen(summary.cost) : '—'} />
        <KpiCard label="CV" value={summary?.conversions?.toLocaleString() ?? '—'} />
        <KpiCard label="CV価値" value={summary ? formatYen(summary.conversionValue) : '—'} />
        <KpiCard label="ROAS" value={summary?.roas != null ? summary.roas.toFixed(2) : '—'} />
      </div>

      {/* Trend */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">日次トレンド（費用 / CV）</h2>
          {summaryLoading && (
            <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          )}
        </div>
        {daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} width={55} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                width={55}
              />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="cost" name="費用" stroke="#2563EB" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="conversions" name="CV" stroke="#EC4899" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            データがありません（バッチ実行後に表示されます）
          </div>
        )}
      </div>

      {/* Campaigns */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-semibold text-gray-700">キャンペーン</h2>
          {campaigns.length > 0 ? (
            <select
              value={activeCampaignId}
              onChange={(e) => setActiveCampaignId(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {campaigns.map((c) => (
                <option key={c.campaign_id} value={c.campaign_id}>
                  {c.campaign_name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <CampaignTable rows={campaigns} activeId={activeCampaignId} onSelect={setActiveCampaignId} />
      </div>

      {/* Ad groups */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          広告グループ（API は直近30日集計。上部の期間ボタンとは無関係）
        </h2>
        <AdGroupTable rows={adGroups} />
      </div>
    </div>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}

function CampaignTable({
  rows,
  activeId,
  onSelect,
}: {
  rows: any[]
  activeId: string
  onSelect: (id: string) => void
}) {
  if (!rows.length) {
    return <p className="text-sm text-gray-400">データがありません</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">キャンペーン</th>
            <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">費用</th>
            <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">CV</th>
            <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r) => {
            const isActive = r.campaign_id === activeId
            return (
              <tr
                key={r.campaign_id}
                className={`cursor-pointer hover:bg-gray-50 transition ${isActive ? 'bg-blue-50' : ''}`}
                onClick={() => onSelect(r.campaign_id)}
              >
                <td className="px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">{r.campaign_name}</p>
                  <p className="text-xs text-gray-400">{r.status ?? ''}</p>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">
                  {typeof r.last30d?.cost === 'number' ? formatYen(r.last30d.cost) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">
                  {typeof r.last30d?.conversions === 'number' ? r.last30d.conversions.toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">
                  {r.last30d?.roas != null ? Number(r.last30d.roas).toFixed(2) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AdGroupTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="text-sm text-gray-400">データがありません</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">広告グループ</th>
            <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">費用</th>
            <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">CV</th>
            <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r) => (
            <tr key={r.ad_group_id} className="hover:bg-gray-50 transition">
              <td className="px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">{r.ad_group_name}</p>
                <p className="text-xs text-gray-400">{r.status ?? ''}</p>
              </td>
              <td className="px-4 py-3 text-right font-semibold text-gray-800">
                {typeof r.last30d?.cost === 'number' ? formatYen(r.last30d.cost) : '—'}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-gray-800">
                {typeof r.last30d?.conversions === 'number' ? r.last30d.conversions.toLocaleString() : '—'}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-gray-800">
                {r.last30d?.roas != null ? Number(r.last30d.roas).toFixed(2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

