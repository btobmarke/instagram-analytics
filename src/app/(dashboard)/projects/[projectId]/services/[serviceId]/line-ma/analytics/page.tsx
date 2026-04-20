'use client'

import { use, useMemo, useState } from 'react'
import useSWR from 'swr'

import { LineMaBreadcrumb } from '../line-ma-nav'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

function defaultRangeIso() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 30)
  return { from: from.toISOString(), to: to.toISOString() }
}

export default function LineMaAnalyticsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const defaults = useMemo(() => defaultRangeIso(), [])

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const [rangeFrom, setRangeFrom] = useState(defaults.from.slice(0, 16))
  const [rangeTo, setRangeTo] = useState(defaults.to.slice(0, 16))

  const fromIso = () => new Date(rangeFrom).toISOString()
  const toIso = () => new Date(rangeTo).toISOString()

  const { data: shortResp, mutate: mutShort } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/short-links` : null,
    fetcher,
  )
  const shortLinks: { id: string; code: string; short_url?: string; target_url: string }[] =
    shortResp?.data ?? []

  const [slTarget, setSlTarget] = useState('https://')
  const [slName, setSlName] = useState('')
  const [slBusy, setSlBusy] = useState(false)

  const createShortLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setSlBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/short-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_url: slTarget.trim(),
        name: slName.trim() || undefined,
      }),
    })
    setSlBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '作成に失敗しました')
      return
    }
    setSlTarget('https://')
    setSlName('')
    mutShort()
  }

  const deleteShortLink = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/short-links/${id}`, { method: 'DELETE' })
    mutShort()
  }

  const [clickLinkId, setClickLinkId] = useState('')
  const [clicks, setClicks] = useState<unknown[] | null>(null)
  const [clickLoading, setClickLoading] = useState(false)

  const fetchClicks = async () => {
    if (!clickLinkId) {
      alert('短縮リンクを選択してください')
      return
    }
    setClickLoading(true)
    const q = new URLSearchParams({
      short_link_id: clickLinkId,
      from: fromIso(),
      to: toIso(),
      limit: '100',
    })
    const res = await fetch(`/api/services/${serviceId}/line-messaging/analytics/link-clicks?${q}`)
    const j = await res.json()
    setClickLoading(false)
    if (!res.ok) {
      alert(j.error ?? '取得に失敗しました')
      setClicks(null)
      return
    }
    setClicks(j.data ?? [])
  }

  const { data: convResp, mutate: mutConv } = useSWR(
    service?.service_type === 'line'
      ? `/api/services/${serviceId}/line-messaging/reports/conversions?from=${encodeURIComponent(fromIso())}&to=${encodeURIComponent(toIso())}`
      : null,
    fetcher,
  )
  type ConvRow = {
    definition_id: string
    name: string
    match_trigger_type: string
    conversion_count: number
  }
  const conversionRows: ConvRow[] = (convResp as { data?: ConvRow[] } | undefined)?.data ?? []

  const { data: oamResp, mutate: mutOam } = useSWR(
    service?.service_type === 'line'
      ? `/api/services/${serviceId}/line-messaging/reports/oam-segment-broadcast?from=${encodeURIComponent(fromIso())}&to=${encodeURIComponent(toIso())}`
      : null,
    fetcher,
  )

  const { data: cvDefsResp, mutate: mutCvDefs } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/conversion-definitions` : null,
    fetcher,
  )
  const cvDefs: { id: string; name: string; match_trigger_type: string; enabled: boolean }[] =
    cvDefsResp?.data ?? []

  const [cvName, setCvName] = useState('')
  const [cvTrigger, setCvTrigger] = useState('webhook.message')

  const { data: funnelsResp, mutate: mutFunnels } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/funnels` : null,
    fetcher,
  )
  const funnels: { id: string; name: string; steps: string[]; max_step_gap_hours: number }[] =
    funnelsResp?.data ?? []

  const [fnName, setFnName] = useState('')
  const [fnSteps, setFnSteps] = useState('webhook.follow\nwebhook.message')
  const [fnGap, setFnGap] = useState('168')

  const [selectedFunnel, setSelectedFunnel] = useState('')
  const { data: funnelReport } = useSWR(
    service?.service_type === 'line' && selectedFunnel
      ? `/api/services/${serviceId}/line-messaging/reports/funnel/${selectedFunnel}`
      : null,
    fetcher,
  )

  const { data: eventsResp } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/events?limit=80` : null,
    fetcher,
  )
  const recentEvents: { trigger_type: string; occurred_at: string }[] = eventsResp?.data ?? []

  const triggerSamples = useMemo(() => {
    const s = new Set<string>()
    for (const e of recentEvents) {
      if (e.trigger_type) s.add(e.trigger_type)
    }
    return [...s].slice(0, 30)
  }, [recentEvents])

  const refreshReports = () => {
    mutConv()
    mutOam()
  }

  const createCvDef = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch(`/api/services/${serviceId}/line-messaging/conversion-definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: cvName.trim(),
        match_trigger_type: cvTrigger.trim(),
        enabled: true,
      }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '作成に失敗しました')
      return
    }
    setCvName('')
    mutCvDefs()
    refreshReports()
  }

  const deleteCvDef = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/conversion-definitions/${id}`, {
      method: 'DELETE',
    })
    mutCvDefs()
    refreshReports()
  }

  const createFunnel = async (e: React.FormEvent) => {
    e.preventDefault()
    const steps = fnSteps
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/funnels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fnName.trim(),
        steps,
        max_step_gap_hours: Number(fnGap) || 168,
      }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '作成に失敗しました')
      return
    }
    setFnName('')
    mutFunnels()
  }

  const deleteFunnel = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await fetch(`/api/services/${serviceId}/line-messaging/funnels/${id}`, { method: 'DELETE' })
    mutFunnels()
    if (selectedFunnel === id) setSelectedFunnel('')
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
        extra="分析"
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          📈
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">分析（UI-9）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
        <label className="text-xs text-gray-500">
          期間開始
          <input
            type="datetime-local"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
            className="block mt-1 px-2 py-1.5 text-sm border rounded-lg"
          />
        </label>
        <label className="text-xs text-gray-500">
          期間終了
          <input
            type="datetime-local"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
            className="block mt-1 px-2 py-1.5 text-sm border rounded-lg"
          />
        </label>
        <button
          type="button"
          onClick={refreshReports}
          className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg"
        >
          CV / OAM レポートを更新
        </button>
      </div>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">短縮リンクを作成</h2>
        <form onSubmit={createShortLink} className="flex flex-col sm:flex-row flex-wrap gap-2 mb-4">
          <input
            type="url"
            value={slTarget}
            onChange={(e) => setSlTarget(e.target.value)}
            placeholder="https://..."
            className="flex-1 min-w-[200px] px-3 py-2 text-sm border rounded-lg"
            required
          />
          <input
            value={slName}
            onChange={(e) => setSlName(e.target.value)}
            placeholder="メモ名（任意）"
            className="px-3 py-2 text-sm border rounded-lg w-48"
          />
          <button
            type="submit"
            disabled={slBusy}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-60"
          >
            {slBusy ? '作成中...' : '作成'}
          </button>
        </form>
        <ul className="text-xs space-y-1 mb-4">
          {shortLinks.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2 border-b border-gray-50 py-1">
              <span>
                <code className="bg-gray-100 px-1 rounded">{l.short_url ?? `/r/${l.code}`}</code>
                {' → '}
                {l.target_url}
              </span>
              <button type="button" className="text-red-500" onClick={() => deleteShortLink(l.id)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-2">短縮リンクのクリックログ</h2>
        <p className="text-xs text-gray-500 mb-4">
          上で作成したリンクを選び、期間内のクリックログを取得します。
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <select
            value={clickLinkId}
            onChange={(e) => setClickLinkId(e.target.value)}
            className="flex-1 min-w-[200px] px-2 py-1.5 text-sm border rounded-lg bg-white"
          >
            <option value="">短縮リンクを選択...</option>
            {shortLinks.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} → {l.target_url?.slice(0, 40)}...
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={fetchClicks}
            disabled={clickLoading}
            className="px-3 py-1.5 text-sm border border-green-300 rounded-lg text-green-800 disabled:opacity-50"
          >
            {clickLoading ? '取得中...' : 'クリック取得'}
          </button>
        </div>
        {clicks && (
          <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-x-auto max-h-64">
            {JSON.stringify(clicks, null, 2)}
          </pre>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">コンバージョン定義と集計</h2>
        <form onSubmit={createCvDef} className="flex flex-wrap gap-2 mb-4 items-end">
          <input
            value={cvName}
            onChange={(e) => setCvName(e.target.value)}
            placeholder="定義名"
            className="px-3 py-2 text-sm border rounded-lg"
            required
          />
          <input
            value={cvTrigger}
            onChange={(e) => setCvTrigger(e.target.value)}
            placeholder="trigger_type（イベントと一致）"
            className="flex-1 min-w-[220px] px-3 py-2 text-sm border rounded-lg font-mono"
            required
          />
          <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg">
            定義を追加
          </button>
        </form>
        {triggerSamples.length > 0 && (
          <p className="text-xs text-gray-500 mb-2">
            直近イベントの trigger_type 例: {triggerSamples.join(', ')}
          </p>
        )}
        <ul className="divide-y divide-gray-100 mb-6">
          {cvDefs.map((d) => (
            <li key={d.id} className="py-2 flex justify-between gap-2 text-sm">
              <span>
                {d.name}{' '}
                <code className="text-xs text-gray-500">{d.match_trigger_type}</code>
              </span>
              <button type="button" className="text-xs text-red-500" onClick={() => deleteCvDef(d.id)}>
                削除
              </button>
            </li>
          ))}
        </ul>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">期間内ユニークコンタクト数</h3>
        {convResp && !convResp.success && (
          <p className="text-xs text-red-600">レポート取得エラー（期間を確認してください）</p>
        )}
        <ul className="space-y-1 text-sm">
          {conversionRows.map((r) => (
            <li key={r.definition_id} className="flex justify-between">
              <span>{r.name}</span>
              <span className="font-semibold text-green-800">{r.conversion_count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-2">OAM × セグメント（付与率）</h2>
        <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-x-auto max-h-80">
          {oamResp?.success ? JSON.stringify(oamResp.data, null, 2) : 'データなしまたはエラー'}
        </pre>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">ファネル</h2>
        <form onSubmit={createFunnel} className="space-y-2 mb-6">
          <input
            value={fnName}
            onChange={(e) => setFnName(e.target.value)}
            placeholder="ファネル名"
            className="w-full px-3 py-2 text-sm border rounded-lg"
            required
          />
          <textarea
            value={fnSteps}
            onChange={(e) => setFnSteps(e.target.value)}
            placeholder="ステップの trigger_type を1行に1つ"
            rows={4}
            className="w-full px-3 py-2 text-xs font-mono border rounded-lg"
          />
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500">
              ステップ間最大時間（時間）
              <input
                type="number"
                value={fnGap}
                onChange={(e) => setFnGap(e.target.value)}
                className="block w-24 mt-1 px-2 py-1 text-sm border rounded-lg"
              />
            </label>
            <button type="submit" className="mt-5 px-4 py-2 text-sm bg-green-600 text-white rounded-lg">
              作成
            </button>
          </div>
        </form>
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={selectedFunnel}
            onChange={(e) => setSelectedFunnel(e.target.value)}
            className="flex-1 min-w-[200px] px-2 py-1.5 text-sm border rounded-lg bg-white"
          >
            <option value="">レポート表示するファネル...</option>
            {funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        {funnelReport?.success && funnelReport.data && (
          <div className="text-sm space-y-2">
            <p className="font-medium">{funnelReport.data.funnel_name}</p>
            <ul className="space-y-1">
              {(funnelReport.data.steps as { step_index: number; trigger_type: string; contacts_reached: number }[]).map(
                (s) => (
                  <li key={s.step_index}>
                    Step {s.step_index}: <code className="text-xs">{s.trigger_type}</code> —{' '}
                    <strong>{s.contacts_reached}</strong> 人
                  </li>
                ),
              )}
            </ul>
          </div>
        )}
        <ul className="mt-4 divide-y divide-gray-100">
          {funnels.map((f) => (
            <li key={f.id} className="py-2 flex justify-between text-sm">
              <span>{f.name}</span>
              <button type="button" className="text-xs text-red-500" onClick={() => deleteFunnel(f.id)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
