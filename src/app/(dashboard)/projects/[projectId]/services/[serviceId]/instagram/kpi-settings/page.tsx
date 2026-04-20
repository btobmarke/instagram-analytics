'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { InstagramServiceSubnav } from '@/components/instagram/InstagramServiceSubnav'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'
import type { MetricCard } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { KpiCardField } from './_components/KpiCardField'
import type { InstagramServiceKpi, InstagramServiceKpiCardType } from '@/types'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

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

function cloneRow(r: LocalKpiRow): LocalKpiRow {
  return { ...r }
}

function cardLabelForRef(
  cardRef: string,
  cardType: InstagramServiceKpiCardType,
  catalog: MetricCard[],
  customCards: MetricCard[],
): string {
  const list = cardType === 'custom_card' ? customCards : catalog
  const found = list.find((c) => c.id === cardRef)
  return found?.label ?? cardRef || '—'
}

function buildPayloadFromRows(rows: LocalKpiRow[]): { kpis: KpiPutRow[] } | { error: string } {
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

  const [editKey, setEditKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<LocalKpiRow | null>(null)

  const [deleteKey, setDeleteKey] = useState<string | null>(null)
  const [deleteLabel, setDeleteLabel] = useState('')

  const dataFingerprint = useMemo(() => JSON.stringify(kpiRes?.data ?? null), [kpiRes?.data])

  useEffect(() => {
    if (!kpiRes?.success || !Array.isArray(kpiRes.data)) return
    const list = kpiRes.data as InstagramServiceKpi[]
    setRows(list.length ? list.map(serverRowToLocal) : [])
  }, [dataFingerprint, kpiRes?.success])

  const addRow = useCallback(() => {
    const row = emptyRow()
    setRows((prev) => [...prev, row])
    setEditDraft(cloneRow(row))
    setEditKey(row.clientKey)
  }, [])

  const openEdit = useCallback((r: LocalKpiRow) => {
    setEditDraft(cloneRow(r))
    setEditKey(r.clientKey)
  }, [])

  const closeEdit = useCallback(() => {
    const key = editKey
    setEditKey(null)
    setEditDraft(null)
    if (key) {
      setRows((prev) => {
        const r = prev.find((x) => x.clientKey === key)
        if (!r) return prev
        const isBlank =
          !r.kpi_name.trim() &&
          !r.target_value.trim() &&
          !r.card_ref.trim() &&
          !r.kpi_description.trim() &&
          r.phase === '1' &&
          r.card_type === 'metric_card'
        if (isBlank) return prev.filter((x) => x.clientKey !== key)
        return prev
      })
    }
  }, [editKey])

  const persistRows = useCallback(
    async (nextRows: LocalKpiRow[], successMessage: string) => {
      setErr(null)
      setMsg(null)
      const built = buildPayloadFromRows(nextRows)
      if ('error' in built) {
        setErr(built.error)
        return false
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
          return false
        }
        const saved = (j.data ?? []) as InstagramServiceKpi[]
        setRows(saved.length ? saved.map(serverRowToLocal) : [])
        setMsg(successMessage)
        await mutate()
        return true
      } finally {
        setSaving(false)
      }
    },
    [mutate, serviceId],
  )

  const save = useCallback(async () => {
    await persistRows(rows, `${rows.length} 件の KPI を保存しました`)
  }, [persistRows, rows])

  const applyEditModal = useCallback(async () => {
    if (!editKey || !editDraft) return
    const next = rows.map((r) => (r.clientKey === editKey ? { ...editDraft, clientKey: editKey } : r))
    const ok = await persistRows(next, 'KPI を更新しました')
    if (ok) {
      setEditKey(null)
      setEditDraft(null)
    }
  }, [editDraft, editKey, persistRows, rows])

  const confirmDelete = useCallback(async () => {
    if (!deleteKey) return
    const prev = rows
    const next = rows.filter((r) => r.clientKey !== deleteKey)
    setDeleteKey(null)
    setDeleteLabel('')
    const ok = await persistRows(next, 'KPI を削除しました')
    if (!ok) setRows(prev)
  }, [deleteKey, persistRows, rows])

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
            KPI はカード一覧で表示します。「編集」でモーダルから変更、「削除」で確認後に即保存されます。新規サービスでは基本 KPI（従来6件＋算出5件）が自動登録されます。
          </p>
        </div>

        {isLoading && <p className="text-sm text-gray-500">読み込み中…</p>}
        {kpiError && <p className="text-sm text-red-600">取得に失敗しました</p>}
        {kpiRes && !kpiRes.success && (
          <p className="text-sm text-red-600">{typeof kpiRes.error === 'string' ? kpiRes.error : '取得に失敗しました'}</p>
        )}

        {!isLoading && kpiRes?.success ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {rows.length === 0 ? (
                <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl px-4 py-8 text-center sm:col-span-2">
                  まだ KPI がありません。「KPI を追加」から追加してください。
                </p>
              ) : (
                rows.map((r, idx) => (
                  <div
                    key={r.clientKey}
                    className="rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/80 p-4 flex flex-col gap-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">フェーズ {r.phase}</p>
                        <h3 className="text-base font-bold text-gray-900 mt-0.5 line-clamp-2">
                          {r.kpi_name || `KPI ${idx + 1}`}
                        </h3>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteKey(r.clientKey)
                            setDeleteLabel(r.kpi_name.trim() || `KPI ${idx + 1}`)
                          }}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <dl className="grid grid-cols-1 gap-2 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-500 shrink-0">目標値</dt>
                        <dd className="font-semibold text-gray-900 tabular-nums text-right">
                          {r.target_value.trim() ? Number(r.target_value.replace(/,/g, '')).toLocaleString() : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-500 shrink-0">紐づく指標</dt>
                        <dd className="text-gray-800 text-right line-clamp-2">
                          {cardLabelForRef(r.card_ref, r.card_type, metricCatalog, customCards)}
                        </dd>
                      </div>
                    </dl>
                    {r.kpi_description.trim() && (
                      <p className="text-xs text-gray-600 line-clamp-3 border-t border-gray-100 pt-2">{r.kpi_description}</p>
                    )}
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
                {saving ? '保存中…' : '一覧を再保存'}
              </button>
            </div>

            {err && <p className="text-sm text-red-600">{err}</p>}
            {msg && <p className="text-sm text-green-700">{msg}</p>}
          </>
        ) : null}
      </div>

      {/* 編集モーダル */}
      {editKey && editDraft && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-gray-900">KPI を編集</h3>
              <button type="button" onClick={closeEdit} className="text-gray-400 hover:text-gray-600 text-sm">
                閉じる
              </button>
            </div>
            <div className="p-5 space-y-4">
              <label className="block text-xs text-gray-600">
                フェーズ（整数）
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={editDraft.phase}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, phase: e.target.value } : d))}
                />
              </label>
              <label className="block text-xs text-gray-600">
                KPI名
                <input
                  type="text"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={editDraft.kpi_name}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, kpi_name: e.target.value } : d))}
                  placeholder="例: 保存率"
                />
              </label>
              <label className="block text-xs text-gray-600">
                目標値（整数・%のときは 50 = 50%）
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={editDraft.target_value}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, target_value: e.target.value } : d))}
                  placeholder="例: 2"
                />
              </label>
              <KpiCardField
                cardType={editDraft.card_type}
                cardRef={editDraft.card_ref}
                catalog={metricCatalog}
                customCards={customCards}
                onChangeType={(t) => setEditDraft((d) => (d ? { ...d, card_type: t, card_ref: '' } : d))}
                onSelectCard={(id) => setEditDraft((d) => (d ? { ...d, card_ref: id } : d))}
              />
              <label className="block text-xs text-gray-600">
                KPI説明
                <textarea
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white min-h-[80px]"
                  value={editDraft.kpi_description}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, kpi_description: e.target.value } : d))}
                  rows={4}
                />
              </label>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                className="px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void applyEditModal()}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認 */}
      {deleteKey && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-gray-200 p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">KPI を削除しますか？</h3>
            <p className="text-sm text-gray-600">
              「{deleteLabel}」を一覧から削除し、サーバーに保存します。この操作は取り消せません。
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteKey(null)
                  setDeleteLabel('')
                }}
                className="px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void confirmDelete()}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? '処理中…' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
