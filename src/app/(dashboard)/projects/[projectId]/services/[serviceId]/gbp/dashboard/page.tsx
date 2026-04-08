'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ---------- 型 ----------
interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
}

interface GbpSite {
  id: string
  gbp_location_name: string
  gbp_title: string | null
  is_active: boolean
  last_synced_at: string | null
}

interface PerformanceRow {
  date: string
  business_impressions_desktop_search: number | null
  business_impressions_mobile_search:  number | null
  business_impressions_desktop_maps:   number | null
  business_impressions_mobile_maps:    number | null
  business_direction_requests:         number | null
  call_clicks:                         number | null
  website_clicks:                      number | null
  business_conversations:              number | null
  business_bookings:                   number | null
  business_food_orders:                number | null
  business_food_menu_clicks:           number | null
}

interface ReviewRow {
  id: string
  review_id: string
  star_rating: string
  comment: string | null
  reviewer_name: string | null
  create_time: string
  reply_comment: string | null
}

// ---------- ユーティリティ ----------
const STAR_LABELS: Record<string, string> = {
  ONE: '★', TWO: '★★', THREE: '★★★', FOUR: '★★★★', FIVE: '★★★★★',
}
const STAR_COLORS: Record<string, string> = {
  ONE: 'text-red-400', TWO: 'text-orange-400', THREE: 'text-yellow-400',
  FOUR: 'text-lime-500', FIVE: 'text-green-500',
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('ja-JP')
}

function PerfCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-lg font-bold text-gray-800">{fmt(value)}</p>
    </div>
  )
}

// ---------- メインページ（ダッシュボード） ----------
export default function GbpDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [activeTab, setActiveTab] = useState<'performance' | 'reviews'>('performance')

  const { data: serviceData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`, fetcher
  )
  const service = serviceData?.data

  const { data: siteData } = useSWR<{ success: boolean; data: GbpSite | null }>(
    `/api/services/${serviceId}/gbp/site`, fetcher
  )
  const site = siteData?.data

  const today  = new Date()
  const before = new Date(today); before.setDate(today.getDate() - 29)
  const { data: perfData } = useSWR<{ success: boolean; data: PerformanceRow[] }>(
    site ? `/api/services/${serviceId}/gbp/performance?start=${before.toISOString().split('T')[0]}&end=${today.toISOString().split('T')[0]}` : null,
    fetcher
  )
  const perfRows = perfData?.data ?? []

  const { data: reviewData } = useSWR<{ success: boolean; data: ReviewRow[]; meta: { total: number } }>(
    site ? `/api/services/${serviceId}/gbp/reviews?per_page=10` : null, fetcher
  )
  const reviews      = reviewData?.data ?? []
  const totalReviews = reviewData?.meta?.total ?? 0

  const perfSum = perfRows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + (r.business_impressions_desktop_search ?? 0) + (r.business_impressions_mobile_search ?? 0) + (r.business_impressions_desktop_maps ?? 0) + (r.business_impressions_mobile_maps ?? 0),
      directions:  acc.directions  + (r.business_direction_requests ?? 0),
      calls:       acc.calls       + (r.call_clicks ?? 0),
      website:     acc.website     + (r.website_clicks ?? 0),
    }),
    { impressions: 0, directions: 0, calls: 0, website: 0 }
  )

  if (!service) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/clients" className="hover:text-teal-600">クライアント一覧</Link>
        <span>›</span>
        <Link href={`/clients/${service.client.id}`} className="hover:text-teal-600">
          {service.client.client_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-teal-600">
          {service.project.project_name}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">{service.service_name}</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-100 to-green-100 flex items-center justify-center text-xl">🏢</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GBP</h1>
          <p className="text-sm text-gray-400">{service.service_name}</p>
        </div>
      </div>

      {/* タブナビ */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/gbp/dashboard`}
          className="px-4 py-2.5 text-sm font-medium text-teal-600 border-b-2 border-teal-600 -mb-px"
        >
          ダッシュボード
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/gbp`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px"
        >
          設定
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/summary`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px"
        >
          サマリー
        </Link>
      </div>

      {/* ロケーション未設定の場合 */}
      {!site && (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center text-gray-400">
          <p className="text-sm">ロケーションが設定されていません</p>
          <Link
            href={`/projects/${projectId}/services/${serviceId}/gbp`}
            className="mt-2 inline-block text-teal-600 text-sm font-medium hover:underline"
          >
            設定画面でロケーションを登録する
          </Link>
        </div>
      )}

      {site && (
        <>
          {/* ロケーション情報 */}
          <div className="flex items-center gap-3 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 mb-5">
            <span className="text-lg">🏢</span>
            <p className="text-sm font-medium text-teal-800">{site.gbp_title ?? site.gbp_location_name}</p>
            {site.last_synced_at && (
              <span className="ml-auto text-xs text-teal-600">
                最終同期: {new Date(site.last_synced_at).toLocaleString('ja-JP')}
              </span>
            )}
          </div>

          {/* サマリーカード */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-500 mb-3">直近30日 サマリー</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <PerfCard label="総インプレッション" value={perfSum.impressions} />
              <PerfCard label="経路リクエスト"     value={perfSum.directions} />
              <PerfCard label="電話タップ"          value={perfSum.calls} />
              <PerfCard label="Webサイトクリック"   value={perfSum.website} />
            </div>
          </div>

          {/* パフォーマンス / レビュー タブ */}
          <div className="flex border-b border-gray-200 mb-4">
            {(['performance', 'reviews'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
                  activeTab === tab
                    ? 'text-teal-700 border-teal-600'
                    : 'text-gray-500 border-transparent hover:text-gray-700'
                }`}
              >
                {tab === 'performance' ? '📊 パフォーマンス' : `💬 レビュー (${totalReviews})`}
              </button>
            ))}
          </div>

          {/* パフォーマンスタブ */}
          {activeTab === 'performance' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {perfRows.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-400">
                  <p>データがありません</p>
                  <p className="text-xs mt-1">バッチが実行されるとデータが表示されます</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {['日付', '検索表示', 'マップ表示', '経路', '電話', 'WEB'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left font-medium text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {perfRows.map(row => (
                        <tr key={row.date} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-700">{row.date}</td>
                          <td className="px-4 py-2 text-gray-600">
                            {fmt((row.business_impressions_desktop_search ?? 0) + (row.business_impressions_mobile_search ?? 0))}
                          </td>
                          <td className="px-4 py-2 text-gray-600">
                            {fmt((row.business_impressions_desktop_maps ?? 0) + (row.business_impressions_mobile_maps ?? 0))}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{fmt(row.business_direction_requests)}</td>
                          <td className="px-4 py-2 text-gray-600">{fmt(row.call_clicks)}</td>
                          <td className="px-4 py-2 text-gray-600">{fmt(row.website_clicks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* レビュータブ */}
          {activeTab === 'reviews' && (
            <div className="space-y-3">
              {reviews.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-2xl border border-gray-200 text-sm text-gray-400">
                  <p>レビューがありません</p>
                  <p className="text-xs mt-1">バッチが実行されるとデータが表示されます</p>
                </div>
              ) : (
                reviews.map(review => (
                  <div key={review.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-sm ${STAR_COLORS[review.star_rating] ?? 'text-gray-400'}`}>
                          {STAR_LABELS[review.star_rating] ?? review.star_rating}
                        </span>
                        <span className="text-xs font-medium text-gray-600">{review.reviewer_name ?? '匿名'}</span>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {new Date(review.create_time).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                    {review.comment && (
                      <p className="text-sm text-gray-700 leading-relaxed">{review.comment}</p>
                    )}
                    {review.reply_comment && (
                      <div className="mt-3 pl-3 border-l-2 border-teal-200">
                        <p className="text-xs text-teal-700 font-medium mb-0.5">オーナーの返信</p>
                        <p className="text-xs text-gray-600">{review.reply_comment}</p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
