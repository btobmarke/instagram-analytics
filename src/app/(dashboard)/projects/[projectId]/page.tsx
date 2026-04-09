'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ServiceRegisterModal } from '@/components/services/ServiceRegisterModal'
import type { ProjectDetail } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SERVICE_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  instagram: { label: 'Instagram', icon: '📸', color: 'bg-pink-50 text-pink-700 border-pink-200' },
  lp: { label: 'LP', icon: '🎯', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  x: { label: 'X', icon: '🐦', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  line: { label: 'LINE', icon: '💬', color: 'bg-green-50 text-green-700 border-green-200' },
  google_ads: { label: 'Google広告', icon: '🔍', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  meta_ads: { label: 'Meta広告', icon: '📊', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  gbp: { label: 'GBP', icon: '🏢', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  owned_media: { label: 'オウンドメディア', icon: '📝', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  summary: { label: 'サマリー', icon: '📋', color: 'bg-gray-50 text-gray-700 border-gray-200' },
}

function getServiceHref(projectId: string, serviceId: string, serviceType: string): string {
  switch (serviceType) {
    case 'instagram':
      return `/projects/${projectId}/services/${serviceId}/instagram/analytics`
    case 'lp':
      return `/projects/${projectId}/services/${serviceId}/lp`
    case 'gbp':
      return `/projects/${projectId}/services/${serviceId}/gbp/dashboard`
    case 'line':
      return `/projects/${projectId}/services/${serviceId}/line/dashboard`
    default:
      return `/projects/${projectId}/services/${serviceId}`
  }
}

export default function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params)
  const [showServiceModal, setShowServiceModal] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: ProjectDetail }>(
    `/api/projects/${projectId}`,
    fetcher
  )

  const project = data?.data

  const handleServiceCreated = (apiKey?: string) => {
    setShowServiceModal(false)
    if (apiKey) setNewApiKey(apiKey)
    mutate()
  }

  const handleDeleteService = async (serviceId: string) => {
    setDeletingServiceId(serviceId)
    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? '削除に失敗しました')
      mutate()
    } catch (e) {
      alert(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setDeletingServiceId(null)
      setDeleteConfirmId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          プロジェクト情報の取得に失敗しました
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/clients" className="hover:text-purple-600">クライアント一覧</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <Link href={`/clients/${project.client_id}`} className="hover:text-purple-600">
          {project.client.client_name}
        </Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-700 font-medium">{project.project_name}</span>
      </nav>

      {/* Project Info */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{project.project_name}</h1>
              <Link href={`/clients/${project.client_id}`} className="text-sm text-purple-600 hover:underline mt-0.5 inline-block">
                {project.client.client_name}
              </Link>
            </div>
          </div>
        </div>
        {project.note && (
          <p className="text-sm text-gray-600 mt-4 bg-gray-50 rounded-lg px-4 py-3">{project.note}</p>
        )}
      </div>

      {/* LP API Key Alert */}
      {newApiKey && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">LP APIキーが生成されました（一度のみ表示）</p>
              <p className="text-xs text-amber-700 mt-1 mb-2">このキーは今後表示されません。必ずコピーして安全な場所に保管してください。</p>
              <div className="flex items-center gap-2 bg-white rounded-lg border border-amber-200 px-3 py-2">
                <code className="text-xs text-gray-800 flex-1 break-all font-mono">{newApiKey}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(newApiKey); }}
                  className="text-amber-600 hover:text-amber-800 flex-shrink-0"
                  title="コピー"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
            <button onClick={() => setNewApiKey(null)} className="text-amber-400 hover:text-amber-600 flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Services Section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">
          サービス
          <span className="ml-2 text-sm font-normal text-gray-400">{project.services.length}件</span>
        </h2>
        <button
          onClick={() => setShowServiceModal(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          サービス追加
        </button>
      </div>

      {project.services.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400">
          <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p className="text-sm">サービスがありません</p>
          <button
            onClick={() => setShowServiceModal(true)}
            className="mt-2 text-purple-600 text-sm font-medium hover:underline"
          >
            最初のサービスを追加する
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {project.services.map((service) => {
            const typeInfo = SERVICE_TYPE_LABELS[service.service_type] ?? {
              label: service.service_type,
              icon: '⚙️',
              color: 'bg-gray-50 text-gray-700 border-gray-200',
            }
            const href = getServiceHref(projectId, service.id, service.service_type)

            return (
              <div
                key={service.id}
                className="bg-white rounded-xl border border-gray-200 hover:shadow-md hover:border-purple-200 transition-all group overflow-hidden"
              >
                {/* メインリンク */}
                <Link href={href} className="block p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{typeInfo.icon}</span>
                      <div>
                        <p className="font-semibold text-gray-900 group-hover:text-purple-700 transition-colors">
                          {service.service_name}
                        </p>
                        <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full border ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-purple-400 transition-colors mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <p className="text-xs text-gray-300 mt-4">
                    登録: {new Date(service.created_at).toLocaleDateString('ja-JP')}
                  </p>
                </Link>
                {/* 外部連携設定リンク + 削除ボタン */}
                <div className="border-t border-gray-100 px-5 py-2.5 flex items-center justify-between bg-gray-50">
                  {service.service_type === 'line' ? (
                    <span className="text-xs text-gray-400">LINE OAM 設定</span>
                  ) : service.service_type === 'gbp' ? (
                    <span className="text-xs text-gray-400">GBP 設定</span>
                  ) : (
                    <span className="text-xs text-gray-400">外部連携 (GA4 / Clarity)</span>
                  )}
                  <div className="flex items-center gap-3">
                    {service.service_type === 'line' ? (
                      <Link
                        href={`/projects/${projectId}/services/${service.id}/line`}
                        className="flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-800 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        設定
                      </Link>
                    ) : service.service_type === 'gbp' ? (
                      <Link
                        href={`/projects/${projectId}/services/${service.id}/gbp`}
                        className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        設定
                      </Link>
                    ) : (
                    <Link
                      href={`/projects/${projectId}/services/${service.id}/integrations`}
                      className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-purple-600 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      設定
                    </Link>
                    )}
                    <button
                      onClick={(e) => { e.preventDefault(); setDeleteConfirmId(service.id) }}
                      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-red-500 transition-colors"
                      title="削除"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      削除
                    </button>
                  </div>
                </div>

                {/* 削除確認ダイアログ */}
                {deleteConfirmId === service.id && (
                  <div className="border-t border-red-100 bg-red-50 px-5 py-3">
                    <p className="text-xs text-red-700 font-medium mb-2">
                      「{service.service_name}」を削除しますか？この操作は取り消せません。
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeleteService(service.id)}
                        disabled={deletingServiceId === service.id}
                        className="px-3 py-1 bg-red-600 text-white text-xs font-medium rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deletingServiceId === service.id ? '削除中...' : '削除する'}
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-3 py-1 bg-white text-gray-600 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50 transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Service Register Modal */}
      {showServiceModal && (
        <ServiceRegisterModal
          projectId={projectId}
          onClose={() => setShowServiceModal(false)}
          onCreated={handleServiceCreated}
        />
      )}
    </div>
  )
}
