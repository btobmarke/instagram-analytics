'use client'

import { useState } from 'react'

const SERVICE_TYPE_OPTIONS = [
  { value: 'instagram', label: 'Instagram', icon: '📸', description: 'Instagramアカウント分析' },
  { value: 'lp', label: 'ランディングページ', icon: '🎯', description: 'LP計測・MAツール' },
  { value: 'x', label: 'X (Twitter)', icon: '🐦', description: 'X アカウント分析' },
  { value: 'line', label: 'LINE', icon: '💬', description: 'LINE 公式アカウント' },
  { value: 'google_ads', label: 'Google 広告', icon: '🔍', description: 'Google Ads 連携' },
  { value: 'meta_ads', label: 'Meta 広告', icon: '📊', description: 'Meta Ads 連携' },
  { value: 'gbp', label: 'Googleビジネス', icon: '🏢', description: 'Google Business Profile' },
  { value: 'owned_media', label: 'オウンドメディア', icon: '📝', description: '自社メディア計測' },
  { value: 'summary', label: 'サマリー', icon: '📋', description: '総合サマリーレポート' },
] as const

type ServiceType = typeof SERVICE_TYPE_OPTIONS[number]['value']

interface ServiceRegisterModalProps {
  projectId: string
  onClose: () => void
  onCreated: (apiKey?: string) => void
}

export function ServiceRegisterModal({ projectId, onClose, onCreated }: ServiceRegisterModalProps) {
  const [step, setStep] = useState<'type' | 'config'>('type')
  const [serviceType, setServiceType] = useState<ServiceType | null>(null)
  const [serviceName, setServiceName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // LP config
  const [lpName, setLpName] = useState('')
  const [lpCode, setLpCode] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [ga4PropertyId, setGa4PropertyId] = useState('')
  const [clarityProjectId, setClarityProjectId] = useState('')
  const [clarityApiKey, setClarityApiKey] = useState('')

  // Instagram config
  const [igUsername, setIgUsername] = useState('')

  const selectedType = SERVICE_TYPE_OPTIONS.find(t => t.value === serviceType)

  const handleSelectType = (type: ServiceType) => {
    setServiceType(type)
    setStep('config')
    // Pre-fill service name from type label
    if (!serviceName) {
      setServiceName(SERVICE_TYPE_OPTIONS.find(t => t.value === type)?.label ?? '')
    }
  }

  const buildConfig = () => {
    if (serviceType === 'lp') {
      return {
        lp_name: lpName || serviceName,
        lp_code: lpCode,
        target_url: targetUrl,
        ...(ga4PropertyId && { ga4_property_id: ga4PropertyId }),
        ...(clarityProjectId && { clarity_project_id: clarityProjectId }),
        ...(clarityApiKey && { clarity_api_key: clarityApiKey }),
      }
    }
    if (serviceType === 'instagram') {
      return igUsername ? { username: igUsername } : undefined
    }
    return undefined
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serviceName.trim()) { setError('サービス名を入力してください'); return }
    if (serviceType === 'lp') {
      if (!lpCode.trim()) { setError('LP_IDを入力してください'); return }
      if (!targetUrl.trim()) { setError('対象URLを入力してください'); return }
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_type: serviceType,
          service_name: serviceName.trim(),
          config: buildConfig(),
        }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error?.message ?? '登録に失敗しました'); return }
      onCreated(json.data?.api_key)
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            {step === 'config' && (
              <button
                onClick={() => setStep('type')}
                className="text-gray-400 hover:text-gray-600 mr-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-lg font-bold text-gray-900">
              {step === 'type' ? 'サービスを追加' : `${selectedType?.icon} ${selectedType?.label}を設定`}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {/* Step 1: Type Selection */}
          {step === 'type' && (
            <div>
              <p className="text-sm text-gray-500 mb-4">追加するサービスの種別を選択してください</p>
              <div className="grid grid-cols-1 gap-2">
                {SERVICE_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSelectType(option.value)}
                    className="flex items-center gap-4 px-4 py-3 rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-all text-left group"
                  >
                    <span className="text-2xl">{option.icon}</span>
                    <div>
                      <p className="font-medium text-gray-900 group-hover:text-purple-700 text-sm">{option.label}</p>
                      <p className="text-xs text-gray-400">{option.description}</p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-purple-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Config */}
          {step === 'config' && serviceType && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Common: Service Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  サービス名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={serviceName}
                  onChange={e => setServiceName(e.target.value)}
                  placeholder="例: 新商品LP / 公式Instagram"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                  maxLength={255}
                />
              </div>

              {/* LP specific config */}
              {serviceType === 'lp' && (
                <>
                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">LP設定</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      LP_ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={lpCode}
                      onChange={e => setLpCode(e.target.value)}
                      placeholder="例: summer2025-lp"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                      maxLength={255}
                    />
                    <p className="text-xs text-gray-400 mt-1">LPを一意に識別するIDです（英数字・ハイフン推奨）</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      対象URL <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="url"
                      value={targetUrl}
                      onChange={e => setTargetUrl(e.target.value)}
                      placeholder="https://example.com/lp"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                      maxLength={500}
                    />
                  </div>

                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">外部連携（任意）</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">GA4 プロパティID</label>
                    <input
                      type="text"
                      value={ga4PropertyId}
                      onChange={e => setGa4PropertyId(e.target.value)}
                      placeholder="例: 123456789"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Microsoft Clarity プロジェクトID</label>
                    <input
                      type="text"
                      value={clarityProjectId}
                      onChange={e => setClarityProjectId(e.target.value)}
                      placeholder="例: abcde12345"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                  </div>
                  {clarityProjectId && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Clarity APIキー</label>
                      <input
                        type="password"
                        value={clarityApiKey}
                        onChange={e => setClarityApiKey(e.target.value)}
                        placeholder="Clarity APIキーを入力"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>
                  )}
                </>
              )}

              {/* Instagram specific config */}
              {serviceType === 'instagram' && (
                <>
                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Instagram設定（任意）</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ユーザーネーム</label>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm">@</span>
                      <input
                        type="text"
                        value={igUsername}
                        onChange={e => setIgUsername(e.target.value)}
                        placeholder="username"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">後からアカウント設定で連携できます</p>
                  </div>
                </>
              )}

              {/* Other service types */}
              {serviceType !== 'lp' && serviceType !== 'instagram' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs text-blue-700">
                    このサービス種別は現在基本設定のみ対応しています。サービス登録後に詳細設定を行えます。
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-60"
                >
                  {loading ? '登録中...' : 'サービスを追加'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
