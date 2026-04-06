'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import type { ClientDetail } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params)
  const [showCreateProject, setShowCreateProject] = useState(false)

  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: ClientDetail }>(
    `/api/clients/${clientId}`,
    fetcher
  )

  const client = data?.data

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !client) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          クライアント情報の取得に失敗しました
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
        <span className="text-gray-700 font-medium">{client.client_name}</span>
      </nav>

      {/* Client Info */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center flex-shrink-0">
              <span className="text-purple-700 font-bold text-xl">
                {client.client_name.charAt(0)}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{client.client_name}</h1>
              <p className="text-sm text-gray-400 mt-1">
                登録日: {new Date(client.created_at).toLocaleDateString('ja-JP')}
              </p>
            </div>
          </div>
        </div>
        {client.note && (
          <p className="text-sm text-gray-600 mt-4 bg-gray-50 rounded-lg px-4 py-3">{client.note}</p>
        )}
      </div>

      {/* Projects Section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">
          プロジェクト
          <span className="ml-2 text-sm font-normal text-gray-400">{client.projects.length}件</span>
        </h2>
        <button
          onClick={() => setShowCreateProject(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新規プロジェクト
        </button>
      </div>

      {client.projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400">
          <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <p className="text-sm">プロジェクトがありません</p>
          <button
            onClick={() => setShowCreateProject(true)}
            className="mt-2 text-purple-600 text-sm font-medium hover:underline"
          >
            最初のプロジェクトを追加する
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {client.projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-purple-200 transition-all group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900 group-hover:text-purple-700 transition-colors">
                    {project.project_name}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    サービス {project.service_count}件
                  </p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-purple-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              {project.note && (
                <p className="text-xs text-gray-500 mt-3 line-clamp-2">{project.note}</p>
              )}
              <p className="text-xs text-gray-300 mt-3">
                登録: {new Date(project.created_at).toLocaleDateString('ja-JP')}
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateProject && (
        <CreateProjectModal
          clientId={clientId}
          onClose={() => setShowCreateProject(false)}
          onCreated={() => { setShowCreateProject(false); mutate() }}
        />
      )}
    </div>
  )
}

function CreateProjectModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [projectName, setProjectName] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectName.trim()) { setError('プロジェクト名を入力してください'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, project_name: projectName.trim(), note: note.trim() || undefined }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error?.message ?? '登録に失敗しました'); return }
      onCreated()
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">新規プロジェクト登録</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">プロジェクト名 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="例: 新商品LP施策2025"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
              maxLength={255}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="任意のメモを入力"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
              maxLength={1000}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              キャンセル
            </button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-60">
              {loading ? '登録中...' : '登録する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
