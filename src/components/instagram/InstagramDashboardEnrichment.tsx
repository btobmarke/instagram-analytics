'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { InstagramDashboardResponse } from '@/lib/instagram/dashboard-data'
import { DEMO_BREAKDOWN_LABELS } from '@/lib/instagram/dashboard-data'

const JOB_LABELS: Record<string, string> = {
  daily_media_collector: '投稿一覧同期',
  hourly_story_media_collector: 'ストーリー投稿同期',
  hourly_media_insight_collector: '投稿インサイト',
  hourly_story_insight_collector: 'ストーリーインサイト',
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

function pctChip(v: number | null): { text: string; className: string } {
  if (v == null) return { text: '—', className: 'text-gray-400' }
  if (v > 0) return { text: `+${v}%`, className: 'text-emerald-600' }
  if (v < 0) return { text: `${v}%`, className: 'text-rose-600' }
  return { text: '±0%', className: 'text-gray-500' }
}

type Period = '7d' | '30d' | '90d'

interface Props {
  accountId: string
  period: Period
  projectId: string
  serviceId: string
}

export function InstagramDashboardEnrichment({ accountId, period, projectId, serviceId }: Props) {
  const [data, setData] = useState<InstagramDashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<string | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/instagram/dashboard?account=${accountId}&period=${period}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '読み込みに失敗しました')
      setData(json.data)
      setBrief(null)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'エラー')
    } finally {
      setLoading(false)
    }
  }, [accountId, period])

  useEffect(() => { void load() }, [load])

  const runBrief = async () => {
    setBriefLoading(true)
    setBriefError(null)
    try {
      const res = await fetch('/api/instagram/dashboard/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, period }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '要約の生成に失敗しました')
      setBrief(json.data?.text ?? '')
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : 'エラー')
    } finally {
      setBriefLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    )
  }

  if (!data) return null

  const f = data.freshness
  const pc = data.periodCompare
  const cur = pc.current
  const prev = pc.previous
  const d = pc.delta

  return (
    <div className="space-y-6">
      {/* 1. データ鮮度・バッチ */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">データ鮮度・同期</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-400 mb-0.5">メディア（最新更新）</p>
            <p className="font-medium text-gray-800">{fmtTs(f.media_updated_at)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-400 mb-0.5">アカウントインサイト取得</p>
            <p className="font-medium text-gray-800">{fmtTs(f.account_insight_fetched_at)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-400 mb-0.5">投稿インサイト（最新スナップショット）</p>
            <p className="font-medium text-gray-800">{fmtTs(f.media_insight_snapshot_at)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-400 mb-0.5">ストーリーインサイト</p>
            <p className="font-medium text-gray-800">{fmtTs(f.story_insight_fetched_at)}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">公開中ストーリー（24h以内投稿）:</span>
          <span className="font-semibold text-pink-700">{f.active_story_count} 件</span>
          {f.active_story_count > 0 && !f.story_insight_fetched_at && (
            <span className="text-amber-600">※ストーリーインサイト未取得の可能性があります</span>
          )}
        </div>
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500 mb-2">直近の Instagram 関連バッチ（全体）</p>
          <div className="flex flex-wrap gap-2">
            {f.batch_runs.map(row => (
              <span
                key={row.job_name}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  row.status === 'success' ? 'bg-green-50 text-green-700' :
                  row.status === 'partial' ? 'bg-amber-50 text-amber-800' :
                  'bg-red-50 text-red-700'
                }`}
                title={row.started_at}
              >
                {JOB_LABELS[row.job_name] ?? row.job_name}
                <span className="opacity-70">{fmtTs(row.finished_at)}</span>
              </span>
            ))}
            {f.batch_runs.length === 0 && (
              <span className="text-gray-400 text-xs">バッチログがありません</span>
            )}
          </div>
        </div>
      </section>

      {/* 2. 期間比較 */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">期間比較（前期同長さとの差）</h2>
        <p className="text-xs text-gray-400 mb-4">
          現在 {cur.since} 〜 {cur.until} / 前期 {prev.since} 〜 {prev.until}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'リーチ合計', cur: cur.metrics.reach, chip: pctChip(d.reach) },
            { label: '表示回数合計', cur: cur.metrics.views, chip: pctChip(d.views) },
            { label: 'プロフィール訪問合計', cur: cur.metrics.profile_views, chip: pctChip(d.profile_views) },
            {
              label: 'フォロワー（期末−期首）',
              cur: cur.follower_start != null && cur.follower_end != null ? cur.follower_end - cur.follower_start : null,
              chip: d.follower_net == null
                ? { text: '—', className: 'text-gray-400' }
                : { text: `${d.follower_net >= 0 ? '+' : ''}${d.follower_net}`, className: d.follower_net >= 0 ? 'text-emerald-600' : 'text-rose-600' },
            },
          ].map(row => (
            <div key={row.label} className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">{row.label}</p>
              <p className="text-lg font-bold text-gray-900">
                {typeof row.cur === 'number' ? row.cur.toLocaleString() : '—'}
              </p>
              <p className={`text-xs font-medium mt-1 ${row.chip.className}`}>前期比 {row.chip.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs">
          <div className="rounded-lg border border-gray-100 py-2">
            <p className="text-gray-400">投稿（現在期間）</p>
            <p className="font-semibold text-gray-800">{cur.posts.total} 本</p>
            <p className="text-gray-500">F {cur.posts.feed} / R {cur.posts.reels} / S {cur.posts.story}</p>
          </div>
          <div className="rounded-lg border border-gray-100 py-2">
            <p className="text-gray-400">投稿（前期）</p>
            <p className="font-semibold text-gray-800">{prev.posts.total} 本</p>
            <p className="text-gray-500">F {prev.posts.feed} / R {prev.posts.reels} / S {prev.posts.story}</p>
          </div>
          <div className="rounded-lg border border-gray-100 py-2 md:col-span-2">
            <p className="text-gray-400">本数差（現在 − 前期）</p>
            <p className={`font-semibold ${(d.posts_total ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {d.posts_total == null ? '—' : `${d.posts_total >= 0 ? '+' : ''}${d.posts_total} 本`}
            </p>
          </div>
        </div>
      </section>

      {/* 3. トップ投稿 */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">期間内トップ投稿（リーチ推定順）</h2>
          <Link
            href={`/projects/${projectId}/services/${serviceId}/instagram/posts`}
            className="text-xs font-medium text-purple-600 hover:underline"
          >
            投稿一覧へ
          </Link>
        </div>
        {data.top_posts.length === 0 ? (
          <p className="text-sm text-gray-500">この期間に該当する投稿がありません。</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.top_posts.map(post => (
              <Link
                key={post.id}
                href={`/posts/${post.id}`}
                className="group flex gap-3 rounded-xl border border-gray-100 p-3 hover:border-purple-200 hover:bg-purple-50/40 transition"
              >
                <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                  {post.thumbnail_url ? (
                    <img src={post.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No img</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-400">{post.posted_at.slice(0, 10)} · {post.media_product_type ?? '—'}</p>
                  <p className="text-xs text-gray-600 line-clamp-2 mt-0.5">{post.caption ?? '（無題）'}</p>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-xs font-medium text-purple-700">
                    <span>R {post.reach?.toLocaleString() ?? '—'}</span>
                    <span>♥ {post.likes?.toLocaleString() ?? '—'}</span>
                    <span>保存 {post.saves?.toLocaleString() ?? '—'}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 3b. ストーリー */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">公開中ストーリー（概ね36時間以内）</h2>
        {data.active_stories.length === 0 ? (
          <p className="text-sm text-gray-500">表示できるストーリーがありません（未投稿または API 上で期限切れの可能性があります）。</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {data.active_stories.map(s => (
              <div key={s.id} className="w-28 flex-shrink-0 text-center">
                <div className="aspect-[9/16] rounded-lg overflow-hidden bg-gray-100 border border-pink-100">
                  {s.thumbnail_url ? (
                    <img src={s.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">—</div>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 mt-1">R {s.reach?.toLocaleString() ?? '—'}</p>
                <p className="text-[10px] text-gray-400">離脱 {s.navigation_exits?.toLocaleString() ?? '—'}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. オーディエンス + プロフィール行動 */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 mb-1">オーディエンス属性（最新スナップショット）</h2>
          <p className="text-xs text-gray-400 mb-4">Meta の demographics（lifetime）を集計した値です。未取得の場合は空です。</p>
          {data.demographics.length === 0 ? (
            <p className="text-sm text-gray-500">属性データがありません。インサイトバッチの実行状況を確認してください。</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.demographics.map((slice, idx) => (
                <div key={`${slice.metric}-${slice.breakdown}-${idx}`} className="rounded-xl border border-gray-100 p-4">
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    {slice.metric === 'follower_demographics' ? 'フォロワー' : 'エンゲージ'} · {DEMO_BREAKDOWN_LABELS[slice.breakdown] ?? slice.breakdown}
                    {slice.as_of_date && <span className="text-gray-400 font-normal">（{slice.as_of_date} 時点）</span>}
                  </p>
                  <ul className="space-y-1.5">
                    {slice.rows.map(r => (
                      <li key={r.label} className="flex justify-between text-sm">
                        <span className="text-gray-700">{r.label}</span>
                        <span className="font-medium text-gray-900">{r.value.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-1">投稿経由のプロフィール行動（最新スナップショット合算）</h3>
          <p className="text-xs text-gray-400 mb-3">各投稿の lifetime 指標を最新スナップショットで足し上げた参考値です。</p>
          {data.profile_activity_posts.by_action.length === 0 ? (
            <p className="text-sm text-gray-500">データがありません。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.profile_activity_posts.by_action.map(a => (
                <span key={a.code} className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-800">
                  <span className="text-gray-500">{a.label}</span>
                  <span className="font-semibold">{a.value.toLocaleString()}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 6. AI 要約 */}
      <section className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">AI ダッシュボード要約</h2>
            <p className="text-xs text-gray-500 mt-1">
              上記の数値のみを材料に短くまとめます（KPI・目標には言及しません）。生成には数秒かかることがあります。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void runBrief()}
              disabled={briefLoading}
              className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              {briefLoading ? '生成中…' : '要約を生成'}
            </button>
            <Link
              href={`/projects/${projectId}/services/${serviceId}/instagram/ai`}
              className="px-4 py-2 rounded-lg border border-purple-200 bg-white text-sm font-medium text-purple-700 hover:bg-purple-50"
            >
              詳細AI分析へ
            </Link>
          </div>
        </div>
        {briefError && (
          <p className="text-sm text-red-600 mb-2">{briefError}</p>
        )}
        {brief && (
          <div className="rounded-xl bg-white/80 border border-white p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {brief}
          </div>
        )}
      </section>
    </div>
  )
}
