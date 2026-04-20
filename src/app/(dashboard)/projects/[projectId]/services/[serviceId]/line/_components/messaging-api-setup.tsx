'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface CredentialsState {
  configured: boolean
  updated_at: string | null
}

export function MessagingApiSetup({ serviceId }: { serviceId: string }) {
  const { data: credData, mutate } = useSWR<{ success?: boolean; data?: CredentialsState; error?: string }>(
    `/api/services/${serviceId}/line-messaging/credentials`,
    fetcher,
  )
  const cred = credData?.data

  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(typeof window !== 'undefined' ? window.location.origin : '')
  }, [])

  const webhookPath = `/api/webhooks/line/${serviceId}`
  const webhookUrl = origin ? `${origin}${webhookPath}` : ''

  const [channelSecret, setChannelSecret] = useState('')
  const [channelToken, setChannelToken] = useState('')
  const [savingCred, setSavingCred] = useState(false)
  const [credError, setCredError] = useState('')

  const [pushTo, setPushTo] = useState('')
  const [pushText, setPushText] = useState('テスト配信です')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)

  const copyWebhook = async () => {
    if (!webhookUrl) return
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setPushMsg('Webhook URL をコピーしました')
      setTimeout(() => setPushMsg(null), 2500)
    } catch {
      setPushMsg('コピーに失敗しました')
    }
  }

  const saveCredentials = async (e: React.FormEvent) => {
    e.preventDefault()
    setCredError('')
    if (!channelSecret.trim() || !channelToken.trim()) {
      setCredError('Channel secret と Channel access token を入力してください')
      return
    }
    setSavingCred(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_secret: channelSecret.trim(),
        channel_access_token: channelToken.trim(),
      }),
    })
    const json = await res.json()
    setSavingCred(false)
    if (!res.ok) {
      setCredError(json.error ?? '保存に失敗しました')
      return
    }
    setChannelSecret('')
    setChannelToken('')
    mutate()
  }

  const sendPushTest = async () => {
    setPushMsg(null)
    if (!pushTo.trim()) {
      setPushMsg('送信先の LINE userId を入力してください')
      return
    }
    setPushBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/push-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushTo.trim(), text: pushText.trim() || 'テスト配信です' }),
    })
    const json = await res.json().catch(() => ({}))
    setPushBusy(false)
    if (!res.ok) {
      setPushMsg(json.message ?? json.error ?? '送信に失敗しました')
      return
    }
    setPushMsg('テストメッセージを送信しました')
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-2">Messaging API（Channel 認証）</h2>
        <p className="text-xs text-gray-500 mb-4">
          Channel secret と long-lived Channel access token を保存します（サーバー側で暗号化）。Webhook は MA
          機能用です。
        </p>
        <div className="flex items-center gap-2 mb-4">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              cred?.configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {cred?.configured ? '認証情報: 設定済み' : '認証情報: 未設定'}
          </span>
          {cred?.updated_at && (
            <span className="text-xs text-gray-400">
              最終更新: {new Date(cred.updated_at).toLocaleString('ja-JP')}
            </span>
          )}
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <p className="text-xs font-medium text-gray-700 mb-1">Webhook URL（LINE Developers に登録）</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs font-mono bg-white border border-gray-200 rounded px-2 py-1.5 break-all flex-1 min-w-0">
              {webhookUrl || '（ページ読み込み後に表示）'}
            </code>
            <button
              type="button"
              onClick={copyWebhook}
              disabled={!webhookUrl}
              className="px-3 py-1.5 text-xs font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 disabled:opacity-50"
            >
              コピー
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            パス: <code className="font-mono">{webhookPath}</code>
          </p>
        </div>

        <form onSubmit={saveCredentials} className="space-y-3 max-w-xl">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Channel secret</label>
            <input
              type="password"
              autoComplete="off"
              value={channelSecret}
              onChange={(e) => setChannelSecret(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 font-mono"
              placeholder="再登録・更新時のみ入力"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Channel access token（long-lived）
            </label>
            <input
              type="password"
              autoComplete="off"
              value={channelToken}
              onChange={(e) => setChannelToken(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 font-mono"
              placeholder="再登録・更新時のみ入力"
            />
          </div>
          {credError && <p className="text-sm text-red-600">{credError}</p>}
          <button
            type="submit"
            disabled={savingCred}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60"
          >
            {savingCred ? '保存中...' : '認証情報を保存'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-2">接続テスト（Push）</h2>
        <p className="text-xs text-gray-500 mb-4">保存済みトークンで任意の LINE userId にテキストを送信します。</p>
        <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
          <input
            type="text"
            value={pushTo}
            onChange={(e) => setPushTo(e.target.value)}
            placeholder="LINE userId（U で始まる）"
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
          />
          <input
            type="text"
            value={pushText}
            onChange={(e) => setPushText(e.target.value)}
            placeholder="メッセージ"
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg"
          />
          <button
            type="button"
            onClick={sendPushTest}
            disabled={pushBusy || !cred?.configured}
            className="px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 disabled:opacity-50"
          >
            {pushBusy ? '送信中...' : '送信'}
          </button>
        </div>
        {!cred?.configured && (
          <p className="text-xs text-amber-600 mt-2">先に認証情報を保存してください。</p>
        )}
        {pushMsg && <p className="text-sm text-gray-600 mt-2">{pushMsg}</p>}
      </div>
    </div>
  )
}
