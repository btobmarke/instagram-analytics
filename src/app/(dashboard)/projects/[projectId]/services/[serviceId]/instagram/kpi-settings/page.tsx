'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { InstagramServiceSubnav } from '@/components/instagram/InstagramServiceSubnav'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'
import type { MetricCard } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { KpiCardField } from './_components/KpiCardField'
import type { InstagramServiceKpi, InstagramServiceKpiCardType } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type LocalKpiRow = {
  clientKey: string
  phase: string
  kpi_name: string
  target_value: string
  card_type: InstagramServiceKpiCardType
  card_ref: string
  kpi_description: string
}

type KpiPutRow = {
  phase: number
  kpi_name: string
  target_value: number
  card_type: InstagramServiceKpiCardType
  card_ref: string
  kpi_description: string
}

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
  service_type: string
}

function newClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function emptyRow(): LocalKpiRow {
  return {
    clientKey: newClientKey(),
    phase: '1',
    kpi_name: '',
    target_value: '',
    card_type: 'metric_card',
    card_ref: '',
    kpi_description: '',
  }
}

function serverRowToLocal(r: InstagramServiceKpi): LocalKpiRow {
  return {
    clientKey: r.id,
    phase: String(r.phase),
    kpi_name: r.kpi_name,
    target_value: String(r.target_value),
    card_type: r.card_type,
    card_ref: r.card_ref ?? '',
    kpi_description: r.kpi_description ?? '',
  }
}

export default function InstagramServiceKpiSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: serviceData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = serviceData?.data

  const metricCatalog = useMemo(() => getMetricCatalog('instagram'), [])

  interface LibraryMetric {
    id: string
    service_id: string
    name: string
    formula: MetricCard['formula']
  }
  const { data: libraryResp } = useSWR<{ success: boolean; data: LibraryMetric[] }>(
    service?.service_type === 'instagram' ? `/api/services/${serviceId}/custom-metrics` : null,
    fetcher,
  )
  const customCards: MetricCard[] = useMemo(
    () =>
      (libraryResp?.data ?? []).map((m) => ({
        id: m.id,
        label: m.name,
        category: 'カスタム指標',
        fieldRef: m.id,
        formula: m.formula as MetricCard['formula'],
      })),
    [libraryResp],
  )

  const { data: kpiRes, error: kpiError, isLoading, mutate } = useSWR<{
    success: boolean
    data?: InstagramServiceKpi[]
    error?: string
  }>(service?.service_type === 'instagram' ? `/api/services/${serviceId}/instagram/kpis` : null, fetcher)

  const [rows, setRows] = useState<LocalKpiRow[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const dataFingerprint = useMemo(() => JSON.stringify(kpiRes?.data ?? null), [kpiRes?.data])

  useEffect(() => {
    if (!kpiRes?.success || !Array.isArray(kpiRes.data)) return
    const list = kpiRes.data as InstagramServiceKpi[]
    setRows(list.length ? list.map(serverRowToLocal) : [])
  }, [dataFingerprint, kpiRes?.success])

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRow()])
  }, [])

  const removeRow = useCallback((clientKey: string) => {
    setRows((prev) => prev.filter((r) => r.clientKey !== clientKey))
  }, [])

  const updateRow = useCallback((clientKey: string, patch: Partial<LocalKpiRow>) => {
    setRows((prev) => prev.map((r) => (r.clientKey === clientKey ? { ...r, ...patch } : r)))
  }, [])

  const buildPayload = useCallback((): { kpis: KpiPutRow[] } | { error: string } => {
    const out: KpiPutRow[] = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const name = r.kpi_name.trim()
      const desc = r.kpi_description.trim()
      const tvRaw = r.target_value.trim().replace(/,/g, '')
      const isBlank =
        !name &&
        !tvRaw &&
        !desc &&
        !r.card_ref.trim() &&
        r.phase === '1' &&
        r.card_type === 'metric_card'
      if (isBlank) continue
      if (!name) {
        return { error: `行 ${i + 1}: KPI名を入力するか、未使用の行は削除してください` }
      }
      if (!r.card_ref.trim()) {
        return { error: `行 ${i + 1}: 指標値カードまたはカスタムカードを1つ選択してください` }
      }
      const phase = parseInt(r.phase, 10)
      if (!Number.isFinite(phase)) {
        return { error: `行 ${i + 1}: フェーズは整数で入力してください` }
      }
      const target_value = parseInt(tvRaw, 10)
      if (!Number.isFinite(target_value)) {
        return { error: `行 ${i + 1}: 目標値は整数で入力してください` }
      }
      out.push({
        phase,
        kpi_name: name,
        target_value,
        card_type: r.card_type,
        card_ref: r.card_ref.trim(),
        kpi_description: desc,
      })
    }
    return { kpis: out }
  }, [rows])

  const save = useCallback(async () => {
    setErr(null)
    setMsg(null)
    const built = buildPayload()
    if ('error' in built) {
      setErr(built.error)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/services/${serviceId}/instagram/kpis`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kpis: built.kpis }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        const e =
          typeof j.error === 'string'
            ? j.error
            : j.error && typeof j.error === 'object'
              ? JSON.stringify(j.error)
              : '保存に失敗しました'
        setErr(e)
        return
      }
      const saved = (j.data ?? []) as InstagramServiceKpi[]
      setRows(saved.length ? saved.map(serverRowToLocal) : [])
      setMsg(`${saved.length} 件の KPI を保存しました`)
      await mutate()
    } finally {
      setSaving(false)
    }
  }, [buildPayload, mutate, serviceId])

  if (service && service.service_type !== 'instagram') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-gray-600">このサービスは Instagram ではありません。</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <nav className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
        <Link href="/clients" className="hover:text-purple-600">
          クライアント一覧
        </Link>
        <span>›</span>
        <Link href={`/clients/${service?.client.id}`} className="hover:text-purple-600">
          {service?.client.client_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">
          {service?.project.project_name}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/instagram`} className="hover:text-pink-600">
          {service?.service_name ?? 'Instagram'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">KPI設定</span>
      </nav>

      <div className="flex items-start justify-between gap-4 -mt-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-xl shrink-0">
            📸
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Instagram</h1>
            <p className="text-sm text-gray-400">{service?.service_name}</p>
          </div>
        </div>
      </div>

      <InstagramServiceSubnav
        projectId={projectId}
        serviceId={serviceId}
        active="kpi-settings"
        className="-mt-2 border-b border-gray-200"
      />

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">KPI設定</h2>
          <p className="text-sm text-gray-600 mt-1 leading-relaxed">
            この Instagram サービス用の KPI を複数登録できます。新規サービス作成時・初回表示時は、設定画面の KPI
            目標値（簡易）に相当する 6 項目が指標カード付きで自動登録されます（目標数値はあとから編集してください）。サマリーと同じ「指標値カード」「カスタムカード」から紐づけ、保存すると一覧が置き換わります。
          </p>
        </div>

        {isLoading && <p className="text-sm text-gray-500">読み込み中…</p>}
        {kpiError && <p className="text-sm text-red-600">取得に失敗しました</p>}
        {kpiRes && !kpiRes.success && (
          <p className="text-sm text-red-600">{typeof kpiRes.error === 'string' ? kpiRes.error : '取得に失敗しました'}</p>
        )}

        {!isLoading && kpiRes?.success ? (
          <>
            <div className="space-y-4">
              {rows.length === 0 ? (
                <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl px-4 py-8 text-center">
                  まだ KPI がありません。「KPI を追加」から行を追加してください。
                </p>
              ) : (
                rows.map((r, idx) => (
                  <div
                    key={r.clientKey}
                    className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-500">KPI {idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeRow(r.clientKey)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        この行を削除
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block text-xs text-gray-600">
                        フェーズ（整数）
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                          value={r.phase}
                          onChange={(e) => updateRow(r.clientKey, { phase: e.target.value })}
                        />
                      </label>
                      <label className="block text-xs text-gray-600">
                        KPI名
                        <input
                          type="text"
                          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                          value={r.kpi_name}
                          onChange={(e) => updateRow(r.clientKey, { kpi_name: e.target.value })}
                          placeholder="例: リーチ数"
                        />
                      </label>
                      <label className="block text-xs text-gray-600">
                        目標値（整数）
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                          value={r.target_value}
                          onChange={(e) => updateRow(r.clientKey, { target_value: e.target.value })}
                          placeholder="例: 10000"
                        />
                      </label>
                    </div>
                    <KpiCardField
                      cardType={r.card_type}
                      cardRef={r.card_ref}
                      catalog={metricCatalog}
                      customCards={customCards}
                      onChangeType={(t) =>
                        updateRow(r.clientKey, { card_type: t, card_ref: '' })
                      }
                      onSelectCard={(id) => updateRow(r.clientKey, { card_ref: id })}
                    />
                    <label className="block text-xs text-gray-600">
                      KPI説明
                      <textarea
                        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white min-h-[72px]"
                        value={r.kpi_description}
                        onChange={(e) => updateRow(r.clientKey, { kpi_description: e.target.value })}
                        placeholder="達成条件や補足など"
                        rows={3}
                      />
                    </label>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={addRow}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
              >
                KPI を追加
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>

            {err && <p className="text-sm text-red-600">{err}</p>}
            {msg && <p className="text-sm text-green-700">{msg}</p>}
          </>
        ) : null}
      </div>
    </div>
  )
}
