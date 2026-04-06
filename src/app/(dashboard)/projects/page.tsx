'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ProjectListItem {
  id: string
  project_name: string
  client_id: string
  client_name: string
  note: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  service_count: number
}

interface ClientListItem {
  id: string
  client_name: string
}

export default function ProjectsPage() {
  const [page, setPage] = useState(1)
  const [selectedClientId, setSelectedClientId] = useState<string>('')

  const { data: clientsData } = useSWR<{
    success: boolean
    data: ClientListItem[]
  }>('/api/clients?page=1&page_size=200', fetcher)

  const clients = clientsData?.data ?? []

  const projectsUrl = `/api/projects?page=${page}&page_size=20${selectedClientId ? `&client_id=${selectedClientId}` : ''}`

  const { data, error, isLoading } = useSWR<{
    success: boolean
    data: ProjectListItem[]
    meta: { page: number; pageSize: number; totalCount: number }
  }>(
    projectsUrl,
    fetcher
  )

  const projects = data?.data ?? []
  const meta = data?.meta

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId)
    setPage(1)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">プロジェクト一覧</h1>
          <p className="text-sm text-gray-500 mt-1">全クライアントのプロジェクトを確認できます</p>
        </div>
        <Link
          href="/clients"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          クライアント管理
        </Link>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <select
            value={selectedClientId}
            onChange={e => handleClientChange(e.target.value)}
            className="pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 appearance-none cursor-pointer"
          >
            <option value="">すべてのクライアント</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>{client.client_name}</option>
            ))}
          </select>
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        {selectedClientId && (
          <button
            onClick={() => handleClientChange('')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            フィルター解除
          </button>
        )}
        {meta && (
          <span className="text-xs text-gray-400 ml-auto">
            {meta.totalCount}件
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          データの取得に失敗しました
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <p className="text-sm">プロジェクトがありません</p>
          <Link href="/clients" className="mt-2 text-purple-600 text-sm font-medium hover:underline">
            クライアントを登録してプロジェクトを作成する
          </Link>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">プロジェクト名</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">クライアント</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">サービス数</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">登録日</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-purple-50/30 transition-colors group">
                    <td className="px-5 py-4">
                      <Link href={`/projects/${project.id}`} className="font-medium text-gray-900 group-hover:text-purple-700 transition-colors">
                        {project.project_name}
                      </Link>
                      {project.note && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{project.note}</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/clients/${project.client_id}`}
                        className="flex items-center gap-2 text-gray-600 hover:text-purple-600 transition-colors"
                      >
                        <div className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-purple-700 font-bold text-xs">{project.client_name.charAt(0)}</span>
                        </div>
                        {project.client_name}
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {project.service_count}件
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-400 text-xs">
                      {new Date(project.created_at).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-gray-300 group-hover:text-purple-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta && meta.totalCount > meta.pageSize && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                前へ
              </button>
              <span className="text-sm text-gray-500">
                {page} / {Math.ceil(meta.totalCount / meta.pageSize)}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(meta.totalCount / meta.pageSize)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                次へ
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
