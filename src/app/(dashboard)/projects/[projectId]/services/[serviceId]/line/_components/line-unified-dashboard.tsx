'use client'

import { use, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
  client: { id: string; client_name: string }
}

interface FriendDaily {
  date: string
  contacts: number | null
  target_reaches: number | null
  blocks: number | null
}

interface FriendAttr {
  gender: string | null
  age: string | null
  percentage: number | null
}

interface StatusRow {
  date: string
  name: string
  valid_cards: number | null
  issued_cards: number | null
  vouchers_awarded: number | null
  vouchers_used: number | null
}

interface PointDist {
  point: number
  users: number | null
}

interface CardSummary {
  id: string
  rewardcard_id: string
  name: string | null
  is_active: boolean
  status_rows: StatusRow[]
  txn_count_30: number
  point_dist: PointDist[]
}

interface AnalyticsData {
  friends: {
    latest_contacts: number | null
    latest_blocks: number | null
    latest_target_reaches: number | null
    contacts_diff: number | null
    daily: FriendDaily[]
    attr_date: string | null
    attr: FriendAttr[]
  }
  cards: CardSummary[]
}

interface MaDashSummary {
  contacts_total: number
  contacts_followed: number
  tags_total: number
  segments_total: number
  short_links_total: number
  link_clicks_30d: number
  broadcast_jobs_total: number
  ma_events_30d: number
}

const GREEN_COLORS = ['#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#dcfce7']
const GENDER_LABEL: Record<string, string> = { male: '男性', female: '女性', unknown: '不明' }

function fmtDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function fmtNum(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString()
}

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff == null) return null
  const positive = diff >= 0
  return (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
        positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {positive ? '+' : ''}
      {diff.toLocaleString()}
    </span>
  )
}

export function LineUnifiedDashboard({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const base = `/projects/${projectId}/services/${serviceId}`

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data

  const { data, isLoading } = useSWR<{ success: boolean; data: AnalyticsData }>(
    `/api/services/${serviceId}/line-oam/analytics`,
    fetcher,
    { refreshInterval: 60_000 },
  )

  const { data: maSumResp } = useSWR<{ success?: boolean; data?: MaDashSummary }>(
    service?.service_type === 'line' ? `/api/services/${serviceId}/line-messaging/reports/dashboard-summary` : null,
    fetcher,
    { refreshInterval: 120_000 },
  )
  const ma = maSumResp?.data

  const analytics = data?.data

  return (
    <div className="w-full max-w-none min-w-0 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">
          💬
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">LINE 統合ダッシュボード</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : !analytics ? (
        <div className="text-center py-20 text-gray-400 text-sm">OAM データを取得できませんでした</div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
              <span className="text-base">📊</span> 公式アカウント（OAM）サマリー
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                label="友だち数"
                value={fmtNum(analytics.friends.latest_contacts)}
                sub={<DiffBadge diff={analytics.friends.contacts_diff} />}
                icon="👥"
              />
              <SummaryCard label="ブロック数" value={fmtNum(analytics.friends.latest_blocks)} icon="🚫" />
              <SummaryCard
                label="リーチ対象"
                value={fmtNum(analytics.friends.latest_target_reaches)}
                icon="📣"
              />
              <SummaryCard
                label="リワードカード"
                value={`${analytics.cards.filter((c) => c.is_active).length} 件`}
                icon="🎴"
              />
            </div>

            {analytics.friends.daily.length > 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 mt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">友だち数推移（直近60日）</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={analytics.friends.daily} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={fmtDate}
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      width={60}
                      tickFormatter={(v) => v.toLocaleString()}
                    />
                    <Tooltip
                      formatter={(v: number) => [v.toLocaleString(), '友だち数']}
                      labelFormatter={fmtDate}
                    />
                    <Line
                      type="monotone"
                      dataKey="contacts"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyCard
                title="友だち数推移"
                message="データがまだありません。バッチを実行すると表示されます。"
              />
            )}

            {analytics.friends.attr.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 mt-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-700">フレンド属性</h3>
                  {analytics.friends.attr_date && (
                    <span className="text-xs text-gray-400">
                      {new Date(analytics.friends.attr_date).toLocaleDateString('ja-JP')} 時点
                    </span>
                  )}
                </div>
                <AttrSection attr={analytics.friends.attr} />
              </div>
            )}

            {analytics.cards.length > 0 && (
              <div className="space-y-4 mt-4">
                <h3 className="text-sm font-semibold text-gray-700">リワードカード</h3>
                {analytics.cards.map((card) => (
                  <CardSection key={card.id} card={card} />
                ))}
              </div>
            )}

            <div className="mt-4">
              <TxnThresholdPanel serviceId={serviceId} cards={analytics.cards} />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
              <span className="text-base">📣</span> Messaging MA（分析指標）
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              コンタクト・タグ・短縮リンククリック等は MA 側のデータです。詳細レポートは{' '}
              <Link href={`${base}/line/analytics`} className="text-green-600 hover:underline">
                分析
              </Link>
              へ。
            </p>
            {ma ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryCard
                  label="MA コンタクト（全件）"
                  value={ma.contacts_total.toLocaleString()}
                  icon="👤"
                />
                <SummaryCard
                  label="フォロー中コンタクト"
                  value={ma.contacts_followed.toLocaleString()}
                  icon="✅"
                />
                <SummaryCard label="タグ数" value={ma.tags_total.toLocaleString()} icon="🏷️" />
                <SummaryCard label="セグメント数" value={ma.segments_total.toLocaleString()} icon="🎯" />
                <SummaryCard label="短縮リンク数" value={ma.short_links_total.toLocaleString()} icon="🔗" />
                <SummaryCard
                  label="リンククリック（30日）"
                  value={ma.link_clicks_30d.toLocaleString()}
                  icon="🖱️"
                />
                <SummaryCard
                  label="配信ジョブ（累計）"
                  value={ma.broadcast_jobs_total.toLocaleString()}
                  icon="📨"
                />
                <SummaryCard label="MA イベント（30日）" value={ma.ma_events_30d.toLocaleString()} icon="⚡" />
              </div>
            ) : (
              <p className="text-sm text-gray-400">MA 指標を読み込み中、または取得できませんでした。</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub?: React.ReactNode
  icon: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  )
}

function EmptyCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <div className="flex items-center justify-center py-8 text-gray-400 text-sm">{message}</div>
    </div>
  )
}

function AttrSection({ attr }: { attr: FriendAttr[] }) {
  const byGender: Record<string, FriendAttr[]> = {}
  for (const row of attr) {
    const g = row.gender ?? 'unknown'
    if (!byGender[g]) byGender[g] = []
    byGender[g].push(row)
  }

  const ageMap: Record<string, number> = {}
  for (const row of attr) {
    if (!row.age) continue
    ageMap[row.age] = (ageMap[row.age] ?? 0) + (row.percentage ?? 0)
  }
  const ageData = Object.entries(ageMap)
    .map(([age, pct]) => ({ age, pct: Math.round(pct * 10) / 10 }))
    .sort((a, b) => a.age.localeCompare(b.age))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <p className="text-xs text-gray-400 mb-3">性別</p>
        <div className="space-y-2">
          {Object.entries(byGender).map(([gender, rows]) => {
            const total = rows.reduce((s, r) => s + (r.percentage ?? 0), 0)
            const pct = Math.round(total * 10) / 10
            return (
              <div key={gender}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-600">{GENDER_LABEL[gender] ?? gender}</span>
                  <span className="text-gray-500 font-medium">{pct}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-400 rounded-full transition-all"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-3">年齢帯（全性別合算）</p>
        {ageData.length > 0 ? (
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={ageData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="age" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} unit="%" />
              <Tooltip formatter={(v: number) => [`${v}%`, '割合']} />
              <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                {ageData.map((_, i) => (
                  <Cell key={i} fill={GREEN_COLORS[i % GREEN_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-gray-400 text-center py-4">年齢データなし</p>
        )}
      </div>
    </div>
  )
}

function CardSection({ card }: { card: CardSummary }) {
  const latest = card.status_rows[0] ?? null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🎴</span>
          <div>
            <p className="font-semibold text-gray-900">{card.name ?? card.rewardcard_id}</p>
            <p className="text-xs text-gray-400 font-mono">{card.rewardcard_id}</p>
          </div>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            card.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
          }`}
        >
          {card.is_active ? '有効' : '無効'}
        </span>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MiniStat label="有効カード数" value={fmtNum(latest?.valid_cards ?? null)} />
          <MiniStat label="発行枚数" value={fmtNum(latest?.issued_cards ?? null)} />
          <MiniStat label="バウチャー付与" value={fmtNum(latest?.vouchers_awarded ?? null)} />
          <MiniStat label="バウチャー使用" value={fmtNum(latest?.vouchers_used ?? null)} />
        </div>

        <div className="flex items-center gap-2 mb-4 text-xs text-gray-400">
          <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
            直近30日の取引 {card.txn_count_30.toLocaleString()} 件
          </span>
          {latest?.date && (
            <span>最終取得: {new Date(latest.date).toLocaleDateString('ja-JP')}</span>
          )}
        </div>

        {card.point_dist.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-2">ポイント分布（最新日）</p>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={card.point_dist} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="point"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  label={{
                    value: 'pt',
                    position: 'insideRight',
                    offset: 0,
                    fontSize: 10,
                    fill: '#9ca3af',
                  }}
                />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <Tooltip formatter={(v: number) => [v.toLocaleString(), 'ユーザー数']} />
                <Bar dataKey="users" fill="#4ade80" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  )
}

function defaultDateRange() {
  const pad = (n: number) => String(n).padStart(2, '0')
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 29)
  return { rangeStart: ymd(start), rangeEnd: ymd(end) }
}

function TxnThresholdPanel({ serviceId, cards }: { serviceId: string; cards: CardSummary[] }) {
  const defaults = useMemo(() => defaultDateRange(), [])
  const [rangeStart, setRangeStart] = useState(defaults.rangeStart)
  const [rangeEnd, setRangeEnd] = useState(defaults.rangeEnd)
  const [minCount, setMinCount] = useState('3')
  const [rewardcardId, setRewardcardId] = useState('')
  const [pointType, setPointType] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [qualifyingUserCount, setQualifyingUserCount] = useState<number | null>(null)
  const [txnRowCount, setTxnRowCount] = useState<number | null>(null)

  const run = async () => {
    setLoading(true)
    setErrorMsg(null)
    setQualifyingUserCount(null)
    setTxnRowCount(null)
    try {
      const q = new URLSearchParams({ rangeStart, rangeEnd, minCount })
      if (rewardcardId) q.set('rewardcardId', rewardcardId)
      if (pointType.trim()) q.set('pointType', pointType.trim())
      const res = await fetch(`/api/services/${serviceId}/line-oam/txn-threshold-users?${q}`)
      const json = await res.json()
      if (!json.success) {
        setErrorMsg(json.error?.message ?? '集計に失敗しました')
        return
      }
      setQualifyingUserCount(json.data.qualifyingUserCount)
      setTxnRowCount(json.data.txnRowCountInRange)
    } catch {
      setErrorMsg('通信に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">来店（付与）回数しきい値集計</h2>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        リワードカードのポイント取引履歴（バッチで取り込んだ CSV）を元に、指定期間に
        <strong className="text-gray-700"> 付与が N 回以上ある顧客数 </strong>
        をその場で集計します。
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-xs text-gray-500">
          開始
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="block mt-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
          />
        </label>
        <label className="text-xs text-gray-500">
          終了
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            className="block mt-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
          />
        </label>
        <label className="text-xs text-gray-500">
          回以上
          <input
            type="number"
            min={1}
            step={1}
            value={minCount}
            onChange={(e) => setMinCount(e.target.value)}
            className="block mt-1 w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
          />
        </label>
        <label className="text-xs text-gray-500">
          カード
          <select
            value={rewardcardId}
            onChange={(e) => setRewardcardId(e.target.value)}
            className="block mt-1 min-w-[180px] px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
          >
            <option value="">全リワードカード合算</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.rewardcard_id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500 flex-1 min-w-[200px]">
          Point Type（任意・完全一致）
          <input
            type="text"
            value={pointType}
            onChange={(e) => setPointType(e.target.value)}
            placeholder="空欄なら全種別を1回として数える"
            className="block mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg font-mono"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? '集計中…' : '集計する'}
        </button>
      </div>
      {errorMsg && <p className="text-sm text-red-600 mb-2">{errorMsg}</p>}
      {qualifyingUserCount != null && txnRowCount != null && (
        <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm">
          <p className="text-gray-700">
            該当顧客数（ユニーク）:{' '}
            <strong className="text-xl text-green-800">{qualifyingUserCount.toLocaleString()}</strong> 人
          </p>
          <p className="text-xs text-gray-500 mt-1">
            期間内の取引行数（フィルタ後）: {txnRowCount.toLocaleString()} 行
          </p>
        </div>
      )}
    </div>
  )
}
