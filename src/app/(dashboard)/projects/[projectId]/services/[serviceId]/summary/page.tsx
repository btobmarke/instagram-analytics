'use client'

import { useState, use, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import type { ServiceDetail, SummaryTemplate } from './_lib/types'
import { listTemplates, createTemplate, deleteTemplate } from './_lib/store'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SERVICE_THEME: Record<string, { accent: string; bg: string; border: string; badge: string }> = {
  instagram: { accent: 'text-pink-600',   bg: 'bg-pink-50',   border: 'border-pink-200',   badge: 'bg-pink-100 text-pink-700' },
  gbp:       { accent: 'text-teal-600',   bg: 'bg-teal-50',   border: 'border-teal-200',   badge: 'bg-teal-100 text-teal-700' },
  line:      { accent: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200',  badge: 'bg-green-100 text-green-700' },
  lp:        { accent: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
  google_ads:{ accent: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700' },
  sales:     { accent: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
}
const SERVICE_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  gbp: 'GBP',
  line: 'LINE OAM',
  lp: 'LP',
  google_ads: 'Google 広告',
  sales: '売上分析',
}

/** サマリーページ上部タブの実ルート（従来の …/dashboard 一律は google_ads / instagram で 404 になる） */
function summaryDashboardHref(projectId: string, serviceId: string, serviceType: string): string {
  const b = `/projects/${projectId}/services/${serviceId}`
  switch (serviceType) {
    case 'lp':
      return `${b}/lp`
    case 'instagram':
      return `${b}/instagram/analytics`
    case 'google_ads':
      return `${b}/google-ads/analytics`
    case 'gbp':
      return `${b}/gbp/dashboard`
    case 'line':
      return `${b}/line/dashboard`
    case 'sales':
      return `${b}/sales/dashboard`
    default:
      return `${b}/${serviceType}`
  }
}

function summarySettingsHref(projectId: string, serviceId: string, serviceType: string): string {
  const b = `/projects/${projectId}/services/${serviceId}`
  switch (serviceType) {
    case 'instagram':
      return `${b}/instagram`
    case 'google_ads':
      return `${b}/google-ads/settings`
    case 'gbp':
      return `${b}/gbp`
    case 'line':
      return `${b}/line`
    default:
      return `${b}/${serviceType}`
  }
}

export default function SummaryTemplatePage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const router = useRouter()

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data
  const serviceType = service?.service_type ?? ''
  const theme = SERVICE_THEME[serviceType] ?? { accent: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' }

  const [templates, setTemplates] = useState<SummaryTemplate[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // テンプレート一覧を読み込む
  const reload = useCallback(async () => {
    const tmpl = await listTemplates(serviceId)
    setTemplates(tmpl)
  }, [serviceId])

  useEffect(() => { reload() }, [reload])

  // 新規作成
  const handleCreate = async () => {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const tmpl = await createTemplate({ serviceId, name: newName.trim() })
      setNewName('')
      setShowCreateModal(false)
      router.push(`/projects/${projectId}/services/${serviceId}/summary/${tmpl.id}`)
    } finally {
      setCreating(false)
    }
  }

  // 削除
  const handleDelete = async (id: string) => {
    await deleteTemplate(id, serviceId)
    await reload()
    setDeleting(null)
  }

  const activeColor = {
    instagram: 'text-pink-600 border-pink-600',
    gbp:       'text-teal-600 border-teal-600',
    line:      'text-green-600 border-green-600',
    lp:        'text-purple-600 border-purple-600',
    google_ads:'text-blue-600 border-blue-600',
    sales:     'text-amber-600 border-amber-600',
  }[serviceType] ?? 'text-purple-600 border-purple-600'

  const tabInactive =
    'px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px'
  const tabActive = `px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${activeColor}`
  const svcPath = `/projects/${projectId}/services/${serviceId}`

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">
          {service?.project?.project_name ?? 'プロジェクト'}
        </Link>
        <Chevron />
        <span className="text-gray-600">{service?.service_name ?? '...'}</span>
      </nav>

      {/* タブナビ（各サービスのメイン画面と同一セットに揃える） */}
      {serviceType && (
        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 flex-wrap">
          {serviceType === 'instagram' && (
            <>
              <Link href={`${svcPath}/instagram/analytics`} className={tabInactive}>
                ダッシュボード
              </Link>
              <Link href={`${svcPath}/instagram/posts`} className={tabInactive}>
                投稿一覧
              </Link>
              <Link href={`${svcPath}/instagram/ai`} className={tabInactive}>
                AI分析
              </Link>
              <Link href={`${svcPath}/instagram`} className={tabInactive}>
                設定
              </Link>
              <Link href={`${svcPath}/summary`} className={tabActive}>
                サマリー
              </Link>
            </>
          )}
          {serviceType === 'google_ads' && (
            <>
              <Link href={`${svcPath}/google-ads/analytics`} className={tabInactive}>
                ダッシュボード
              </Link>
              <Link href={`${svcPath}/summary`} className={tabActive}>
                サマリー
              </Link>
              <Link href={`${svcPath}/google-ads/ai`} className={tabInactive}>
                AI分析
              </Link>
              <Link href={`${svcPath}/google-ads/ai/chat`} className={tabInactive}>
                AIチャット
              </Link>
              <Link href={`${svcPath}/google-ads/settings`} className={tabInactive}>
                設定
              </Link>
            </>
          )}
          {serviceType === 'sales' && (
            <>
              <Link href={`${svcPath}/sales/dashboard`} className={tabInactive}>
                ダッシュボード
              </Link>
              <Link href={`${svcPath}/sales/records`} className={tabInactive}>
                売上登録
              </Link>
              <Link href={`${svcPath}/sales/products`} className={tabInactive}>
                商品マスタ
              </Link>
              <Link href={`${svcPath}/summary`} className={tabActive}>
                サマリー
              </Link>
            </>
          )}
          {serviceType !== 'instagram' &&
            serviceType !== 'google_ads' &&
            serviceType !== 'sales' && (
            <>
              <Link href={summaryDashboardHref(projectId, serviceId, serviceType)} className={tabInactive}>
                ダッシュボード
              </Link>
              {serviceType !== 'lp' && (
                <Link href={summarySettingsHref(projectId, serviceId, serviceType)} className={tabInactive}>
                  設定
                </Link>
              )}
              <Link href={`${svcPath}/summary`} className={tabActive}>
                サマリー
              </Link>
            </>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">サマリーテンプレート</h1>
          <p className="text-xs text-gray-500 mt-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium mr-1 ${theme.badge}`}>
              {SERVICE_LABEL[serviceType] ?? serviceType}
            </span>
            複数のテンプレートを作成して、サービスごとにサマリーを管理できます
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新規テンプレート
        </button>
      </div>

      {/* テンプレート一覧 */}
      {templates.length === 0 ? (
        <div className={`rounded-2xl border-2 border-dashed ${theme.border} ${theme.bg} p-12 text-center`}>
          <div className="w-12 h-12 rounded-full bg-white/60 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-600 mb-1">テンプレートがありません</p>
          <p className="text-xs text-gray-400 mb-4">「新規テンプレート」から最初のテンプレートを作成しましょう</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新規テンプレートを作成
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map(tmpl => (
            <div
              key={tmpl.id}
              className="bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition p-4 flex items-center justify-between group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-lg ${theme.bg} ${theme.border} border flex items-center justify-center flex-shrink-0`}>
                  <svg className={`w-4 h-4 ${theme.accent}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{tmpl.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {tmpl.rows.length}項目
                    {tmpl.customCards.length > 0 && ` · カスタム指標${tmpl.customCards.length}件`}
                    {' · '}横軸: {
                      { hour: '1時間', day: '1日', week: '1週間', month: '1ヶ月' }[tmpl.timeUnit]
                    }
                    {' · '}更新: {new Date(tmpl.updatedAt).toLocaleDateString('ja-JP')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {/* サマリーを見る */}
                <Link
                  href={`/projects/${projectId}/services/${serviceId}/summary/${tmpl.id}/view`}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  サマリーを見る
                </Link>
                {/* 編集 */}
                <Link
                  href={`/projects/${projectId}/services/${serviceId}/summary/${tmpl.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  編集
                </Link>
                {/* 削除 */}
                <button
                  onClick={() => setDeleting(tmpl.id)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition"
                  title="削除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新規作成モーダル */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">新規テンプレート</h2>
              <p className="text-xs text-gray-500 mt-0.5">テンプレート名を入力してください</p>
            </div>
            <div className="px-6 py-5">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="例: 月次サマリー"
                autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                キャンセル
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="px-5 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-200 disabled:text-gray-400 transition"
              >
                {creating ? '作成中...' : '作成して編集へ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleting(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">テンプレートを削除</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                「{templates.find(t => t.id === deleting)?.name}」を削除します。この操作は取り消せません。
              </p>
            </div>
            <div className="px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setDeleting(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                キャンセル
              </button>
              <button
                onClick={() => handleDelete(deleting)}
                className="px-5 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Chevron() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}
