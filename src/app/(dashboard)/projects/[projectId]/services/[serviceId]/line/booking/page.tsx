'use client'

import { use, useState } from 'react'
import useSWR from 'swr'


const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  service_name: string
  service_type: string
  project: { project_name: string }
}

export default function LineMaBookingPage({
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

  const { data: svcListResp, mutate: mutBs } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/booking-services` : null,
    fetcher,
  )
  const bookingServices: {
    id: string
    name: string
    duration_minutes: number
    capacity_per_slot: number
    is_active: boolean
  }[] = svcListResp?.data ?? []

  const [bsName, setBsName] = useState('')
  const [bsDur, setBsDur] = useState('30')
  const [bsCap, setBsCap] = useState('1')
  const [bsBusy, setBsBusy] = useState(false)

  const [slotBs, setSlotBs] = useState('')
  const [slotFrom, setSlotFrom] = useState('')
  const [slotTo, setSlotTo] = useState('')
  const [slotMin, setSlotMin] = useState('')
  const [slotBusy, setSlotBusy] = useState(false)

  const { data: bookResp, mutate: mutBook } = useSWR(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/bookings?limit=100` : null,
    fetcher,
  )
  const bookings: Record<string, unknown>[] = bookResp?.data ?? []

  const createBs = async (e: React.FormEvent) => {
    e.preventDefault()
    setBsBusy(true)
    const res = await fetch(`/api/services/${serviceId}/line-messaging/booking-services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: bsName.trim(),
        duration_minutes: Number(bsDur) || 30,
        capacity_per_slot: Number(bsCap) || 1,
        is_active: true,
      }),
    })
    setBsBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? '作成に失敗しました')
      return
    }
    setBsName('')
    mutBs()
  }

  const genSlots = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!slotBs || !slotFrom || !slotTo) return
    setSlotBusy(true)
    const res = await fetch(
      `/api/services/${serviceId}/line-messaging/booking-services/${slotBs}/slots`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generate: {
            from: new Date(slotFrom).toISOString(),
            to: new Date(slotTo).toISOString(),
            ...(slotMin.trim() ? { slot_minutes: Number(slotMin) } : {}),
          },
        }),
      },
    )
    const j = await res.json().catch(() => ({}))
    setSlotBusy(false)
    if (!res.ok) {
      alert(j.error ?? 'スロット生成に失敗しました')
      return
    }
    alert(`スロットを ${(j.data as { created?: number })?.created ?? '?'} 件作成しました`)
  }

  const cancelBooking = async (id: string) => {
    if (!confirm('この予約をキャンセルしますか？')) return
    const res = await fetch(`/api/services/${serviceId}/line-messaging/bookings/${id}/cancel`, {
      method: 'POST',
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? 'キャンセルに失敗しました')
      return
    }
    mutBook()
  }

  if (service && service.service_type !== 'line') {
    return <div className="p-6 text-sm text-gray-600">LINE サービスではありません。</div>
  }

  return (
    <div className="w-full max-w-none min-w-0">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          📅
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">予約（UI-10）</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      <p className="text-xs text-gray-600 bg-gray-50 border rounded-lg px-3 py-2 mb-6">
        エンドユーザー向けの予約は公開 API（`/api/public/line-booking/...`）です。ここではサービス・スロット・予約一覧の管理のみ行います。
      </p>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-4">予約サービス</h2>
        <form onSubmit={createBs} className="flex flex-wrap gap-2 items-end mb-4">
          <input
            value={bsName}
            onChange={(e) => setBsName(e.target.value)}
            placeholder="サービス名"
            className="px-3 py-2 text-sm border rounded-lg flex-1 min-w-[180px]"
            required
          />
          <label className="text-xs text-gray-500">
            所要（分）
            <input
              type="number"
              value={bsDur}
              onChange={(e) => setBsDur(e.target.value)}
              className="block w-20 mt-1 px-2 py-1.5 text-sm border rounded-lg"
            />
          </label>
          <label className="text-xs text-gray-500">
            枠あたり
            <input
              type="number"
              value={bsCap}
              onChange={(e) => setBsCap(e.target.value)}
              className="block w-20 mt-1 px-2 py-1.5 text-sm border rounded-lg"
            />
          </label>
          <button
            type="submit"
            disabled={bsBusy}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-60"
          >
            追加
          </button>
        </form>
        <ul className="text-sm space-y-2">
          {bookingServices.map((s) => (
            <li key={s.id} className="border border-gray-100 rounded-lg px-3 py-2">
              {s.name}{' '}
              <span className="text-xs text-gray-400">
                {s.duration_minutes}分 / 枠{s.capacity_per_slot}名
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h2 className="font-bold text-gray-900 mb-2">スロット一括生成</h2>
        <p className="text-xs text-gray-500 mb-4">
          空欄の slot_minutes はサービスの所要時間と同じ間隔で分割します。
        </p>
        <form onSubmit={genSlots} className="space-y-3 max-w-xl">
          <select
            value={slotBs}
            onChange={(e) => setSlotBs(e.target.value)}
            className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
            required
          >
            <option value="">予約サービス...</option>
            {bookingServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">
              開始
              <input
                type="datetime-local"
                value={slotFrom}
                onChange={(e) => setSlotFrom(e.target.value)}
                className="block w-full mt-1 px-2 py-1.5 text-sm border rounded-lg"
                required
              />
            </label>
            <label className="text-xs text-gray-500">
              終了
              <input
                type="datetime-local"
                value={slotTo}
                onChange={(e) => setSlotTo(e.target.value)}
                className="block w-full mt-1 px-2 py-1.5 text-sm border rounded-lg"
                required
              />
            </label>
          </div>
          <label className="text-xs text-gray-500 block">
            スロット間隔（分・任意）
            <input
              type="number"
              value={slotMin}
              onChange={(e) => setSlotMin(e.target.value)}
              className="block w-32 mt-1 px-2 py-1.5 text-sm border rounded-lg"
            />
          </label>
          <button
            type="submit"
            disabled={slotBusy}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-60"
          >
            {slotBusy ? '生成中...' : 'スロットを生成'}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-900 mb-4">予約一覧</h2>
        {bookings.length === 0 ? (
          <p className="text-sm text-gray-400">予約がありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2">状態</th>
                  <th className="py-2 pr-2">line_user</th>
                  <th className="py-2 pr-2">ゲスト</th>
                  <th className="py-2 pr-2">slot_id</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={String(b.id)} className="border-b border-gray-50">
                    <td className="py-2 pr-2">{String(b.status ?? '')}</td>
                    <td className="py-2 pr-2 font-mono truncate max-w-[120px]">
                      {String(b.line_user_id ?? '')}
                    </td>
                    <td className="py-2 pr-2">{String(b.guest_name ?? '—')}</td>
                    <td className="py-2 pr-2 font-mono text-[10px] truncate max-w-[100px]">
                      {String(b.booking_slot_id ?? '').slice(0, 8)}…
                    </td>
                    <td className="py-2">
                      {b.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="text-red-600"
                          onClick={() => cancelBooking(String(b.id))}
                        >
                          キャンセル
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
