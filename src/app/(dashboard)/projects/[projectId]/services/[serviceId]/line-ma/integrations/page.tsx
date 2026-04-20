'use client'

import { use, useState } from 'react'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

const SCOPES = ['contacts:read', 'tags:read', 'tags:write', 'broadcast:write'] as const

export default function LineMaIntegrationsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const { data: hooksResp, mutate: mutHooks } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/outbound-webhooks` : null,
    fetcher,
  )
  const hooks: {
    id: string
    name: string
    target_url: string
    enabled: boolean
    event_prefixes: string[]
  }[] = hooksResp?.data ?? []

  const { data: keysResp, mutate: mutKeys } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/external-api-keys` : null,
    fetcher,
  )
  const keys: {
    id: string
    name: string
    key_prefix: string
    scopes: string[]
    revoked_at: string | null
  }[] = keysResp?.data ?? []

  const [hookName, setHookName] = useState('')
  const [hookUrl, setHookUrl] = useState('https://')
  const [hookSecret, setHookSecret] = useState('')
  const [hookPrefixes, setHookPrefixes] = useState('')
  const [hookBusy, setHookBusy] = useState(false)

  const [keyName, setKeyName] = useState('')
  const [keyScopes, setKeyScopes] = useState<Set<string>>(new Set(['contacts:read']))
  const [keyBusy, setKeyBusy] = useState(false)
  const [lastPlainKey, setLastPlainKey] = useState<string | null>(null)

  const createHook = async (e: React.FormEvent) => {
    e.preventDefault()
    setHookBusy(true)
    const event_prefixes = hookPrefixes
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/outbound-webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: hookName.trim(),
        target_url: hookUrl.trim(),
        shared_secret: hookSecret.trim() || undefined,
        event_prefixes,
        enabled: true,
      }),
    })
    setHookBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '作成に失敗しました')
      return
    }
    setHookName('')
    setHookUrl('https://')
    setHookSecret('')
    setHookPrefixes('')
    mutHooks()
  }

  const deleteHook = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/outbound-webhooks/${id}`, { method: 'DELETE' })
    mutHooks()
  }

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (keyScopes.size === 0) {
      alert('スコープを1つ以上選んでください')
      return
    }
    setKeyBusy(true)
    setLastPlainKey(null)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/external-api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: keyName.trim(),
        scopes: [...keyScopes],
      }),
    })
    const j = await res.json()
    setKeyBusy(false)
    if (!res.ok) {
      alert(j.error ?? '発行に失敗しました')
      return
    }
    const plain = (j.data as { api_key_plaintext?: string })?.api_key_plaintext
    if (plain) setLastPlainKey(plain)
    setKeyName('')
    mutKeys()
  }

  const revokeKey = async (id: string) => {
    if (!confirm('このキーを失効しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/external-api-keys/${id}/revoke`, {
      method: 'POST',
    })
    mutKeys()
  }

  const toggleScope = (s: string) => {
    setKeyScopes((prev) => {
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })
  }

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  return (
    <div className="p-6 w-full max-w-none">
      <LineMaBreadcrumb
        projectId={projectId}
        serviceId={serviceId}
        projectName={service?.project.project_name ?? ''}
        serviceName={service?.service_name ?? ''}
        extra="外部連携"
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          🔗
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">外部連携（UI-11）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-2">Outbound Webhook</h2>
        <p className="text-xs text-gray-500 mb-4">
          内部イベント発生時に、指定 URL へ通知します。共有シークレットは保存時のみ送信し、以降は表示されません。
        </p>
        <form onSubmit={createHook} className="space-y-3 max-w-xl mb-6">
          <input
            value={hookName}
            onChange={(e) => setHookName(e.target.value)}
            placeholder="名前"
            className="w-full px-3 py-2 text-sm border rounded-lg"
            required
          />
          <input
            type="url"
            value={hookUrl}
            onChange={(e) => setHookUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 text-sm border rounded-lg"
            required
          />
          <input
            type="password"
            value={hookSecret}
            onChange={(e) => setHookSecret(e.target.value)}
            placeholder="共有シークレット（8文字以上・任意）"
            className="w-full px-3 py-2 text-sm border rounded-lg"
          />
          <textarea
            value={hookPrefixes}
            onChange={(e) => setHookPrefixes(e.target.value)}
            placeholder="event_prefixes（1行に1つ・空なら全件）"
            rows={3}
            className="w-full px-3 py-2 text-xs font-mono border rounded-lg"
          />
          <button
            type="submit"
            disabled={hookBusy}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-60"
          >
            {hookBusy ? '作成中...' : '追加'}
          </button>
        </form>
        <ul className="space-y-2 text-sm">
          {hooks.map((h) => (
            <li key={h.id} className="border border-gray-100 rounded-lg p-3 flex justify-between gap-2">
              <div>
                <p className="font-medium">{h.name}</p>
                <p className="text-xs text-gray-500 break-all">{h.target_url}</p>
                <p className="text-xs text-gray-400">
                  {h.enabled ? '有効' : '無効'} · prefixes: {(h.event_prefixes ?? []).join(', ') || '（全件）'}
                </p>
              </div>
              <button type="button" className="text-xs text-red-500 flex-shrink-0" onClick={() => deleteHook(h.id)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-2">外部 API キー</h2>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
          平文キーは発行レスポンスの<strong>一度きり</strong>です。必ずコピーして安全に保管してください。
        </p>
        <form onSubmit={createKey} className="space-y-3 mb-6">
          <input
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="キー名（識別用）"
            className="w-full px-3 py-2 text-sm border rounded-lg max-w-xl"
            required
          />
          <div className="flex flex-wrap gap-3">
            {SCOPES.map((s) => (
              <label key={s} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={keyScopes.has(s)}
                  onChange={() => toggleScope(s)}
                />
                <code className="text-xs">{s}</code>
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={keyBusy}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-60"
          >
            {keyBusy ? '発行中...' : 'キーを発行'}
          </button>
        </form>
        {lastPlainKey && (
          <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-xs text-gray-700 mb-1">発行されたキー（再表示されません）</p>
            <code className="text-xs break-all select-all">{lastPlainKey}</code>
          </div>
        )}
        <ul className="space-y-2 text-sm">
          {keys.map((k) => (
            <li key={k.id} className="border border-gray-100 rounded-lg p-3 flex justify-between gap-2">
              <div>
                <p className="font-medium">{k.name}</p>
                <p className="text-xs text-gray-500 font-mono">{k.key_prefix}…</p>
                <p className="text-xs text-gray-400">{(k.scopes ?? []).join(', ')}</p>
                {k.revoked_at && <p className="text-xs text-red-600">失効済み</p>}
              </div>
              {!k.revoked_at && (
                <button type="button" className="text-xs text-red-500" onClick={() => revokeKey(k.id)}>
                  失効
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
