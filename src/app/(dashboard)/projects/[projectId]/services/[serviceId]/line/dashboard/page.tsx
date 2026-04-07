'use client'

import { use } from 'react'
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

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── 型 ───────────────────────────────────────────────────────────
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

// ── 定数 ─────────────────────────────────────────────────────────
const GREEN_COLORS = ['#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#dcfce7']
const GENDER_LABEL: Record<string, string> = { male: '男性', female: '女性', unknown: '不明' }

// ── ユーティリティ ────────────────────────────────────────────────
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
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
      positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {positive ? '+' : ''}{diff.toLocaleString()}
    </span>
  )
}

// ── メインページ ──────────────────────────────────────────────────
export default function LineOamDashboard({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = svcData?.data

  const { data, isLoading } = useSWR<{ success: boolean; data: AnalyticsData }>(
    `/api/services/${serviceId}/line-oam/analytics`,
    fetcher,
    { refreshInterval: 60_000 }
  )

  const analytics = data?.data

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/projects" className="hover:text-purple-600">プロジェクト</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">
          {service?.project.project_name ?? '...'}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/integrations`} className="hover:text-purple-600">
          {service?.service_name ?? '...'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">LINE OAM</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center text-xl">💬</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">LINE OAM</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      {/* タブナビ */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        <Link
          href={`/projects/${projectId}/services/${serviceId}/line/dashboard`}
          className="px-4 py-2.5 text-sm font-medium text-green-600 border-b-2 border-green-600 -mb-px"
        >
          ダッシュボード
        </Link>
        <Link
          href={`/projects/${projectId}/services/${serviceId}/line`}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px"
        >
          設定
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : !analytics ? (
        <div className="text-center py-20 text-gray-400 text-sm">データを取得できませんでした</div>
      ) : (
        <div className="space-y-6">
          {/* ── サマリーカード ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="友だち数"
              value={fmtNum(analytics.friends.latest_contacts)}
              sub={<DiffBadge diff={analytics.friends.contacts_diff} />}
              icon="👥"
            />
            <SummaryCard
              label="ブロック数"
              value={fmtNum(analytics.friends.latest_blocks)}
              icon="🚫"
            />
            <SummaryCard
              label="リーチ対象"
              value={fmtNum(analytics.friends.latest_target_reaches)}
              icon="📣"
            />
            <SummaryCard
              label="リワードカード"
              value={`${analytics.cards.filter(c => c.is_active).length} 件`}
              icon="🎴"
            />
          </div>

          {/* ── フレンド数推移 ── */}
          {analytics.friends.daily.length > 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">友だち数推移（直近60日）</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={analytics.friends.daily} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} width={60} tickFormatter={v => v.toLocaleString()} />
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
            <EmptyCard title="友だち数推移" message="データがまだありません。バッチを実行すると表示されます。" />
          )}

          {/* ── フレンド属性 ── */}
          {analytics.friends.attr.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">フレンド属性</h2>
                {analytics.friends.attr_date && (
                  <span className="text-xs text-gray-400">
                    {new Date(analytics.friends.attr_date).toLocaleDateString('ja-JP')} 時点
                  </span>
                )}
              </div>
              <AttrSection attr={analytics.friends.attr} />
            </div>
          )}

          {/* ── リワードカード ── */}
          {analytics.cards.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">リワードカード</h2>
              {analytics.cards.map(card => (
                <CardSection key={card.id} card={card} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── サマリーカード ────────────────────────────────────────────────
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

// ── 空状態カード ──────────────────────────────────────────────────
function EmptyCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      <div className="flex items-center justify-center py-8 text-gray-400 text-sm">{message}</div>
    </div>
  )
}

// ── フレンド属性セクション ────────────────────────────────────────
function AttrSection({ attr }: { attr: FriendAttr[] }) {
  // 性別でグルーピング
  const byGender: Record<string, FriendAttr[]> = {}
  for (const row of attr) {
    const g = row.gender ?? 'unknown'
    if (!byGender[g]) byGender[g] = []
    byGender[g].push(row)
  }

  // 年齢帯グラフ用データ（全性別合算）
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
      {/* 性別 */}
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

      {/* 年齢帯 */}
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

// ── カードセクション ──────────────────────────────────────────────
function CardSection({ card }: { card: CardSummary }) {
  const latest = card.status_rows[0] ?? null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* ヘッダー */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🎴</span>
          <div>
            <p className="font-semibold text-gray-900">{card.name ?? card.rewardcard_id}</p>
            <p className="text-xs text-gray-400 font-mono">{card.rewardcard_id}</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          card.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
        }`}>
          {card.is_active ? '有効' : '無効'}
        </span>
      </div>

      <div className="p-6">
        {/* KPI グリッド */}
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

        {/* ポイント分布 */}
        {card.point_dist.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-2">ポイント分布（最新日）</p>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={card.point_dist} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="point" tick={{ fontSize: 10, fill: '#9ca3af' }} label={{ value: 'pt', position: 'insideRight', offset: 0, fontSize: 10, fill: '#9ca3af' }} />
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
