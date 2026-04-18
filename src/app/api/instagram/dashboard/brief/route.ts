export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  buildInstagramDashboardData,
  dashboardDateRanges,
  type DashboardPeriod,
} from '@/lib/instagram/dashboard-data'
import { summarizeDashboardBrief } from '@/lib/claude/client'
import { getAiModelIdForAccountId } from '@/lib/ai/resolve-ai-model'
import type { AiModelOptionId } from '@/lib/ai/model-options'

function periodLabel(p: DashboardPeriod): string {
  return p === '7d' ? '直近7日' : p === '30d' ? '直近30日' : '直近90日'
}

function pct(v: number | null): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v}%`
}

// POST /api/instagram/dashboard/brief  { accountId, period? }
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { accountId?: string; period?: DashboardPeriod }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON ボディが必要です' }, { status: 400 })
  }

  const accountId = body.accountId
  const period = (body.period ?? '30d') as DashboardPeriod

  if (!accountId) {
    return NextResponse.json({ error: 'accountId が必要です' }, { status: 400 })
  }
  if (!['7d', '30d', '90d'].includes(period)) {
    return NextResponse.json({ error: 'period は 7d / 30d / 90d のいずれかです' }, { status: 400 })
  }

  const { data: account } = await supabase
    .from('ig_accounts')
    .select('username')
    .eq('id', accountId)
    .single()

  if (!account) {
    return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })
  }

  const { data: strategyRow } = await supabase
    .from('account_strategy_settings')
    .select('strategy_text')
    .eq('account_id', accountId)
    .maybeSingle()

  const dashboard = await buildInstagramDashboardData(supabase, accountId, period)
  const { since, until, prevSince, prevUntil } = dashboardDateRanges(period)

  const c = dashboard.periodCompare.current
  const p = dashboard.periodCompare.previous
  const d = dashboard.periodCompare.delta

  const periodCompareSummary = `
現在: ${c.since}〜${c.until} / 前期: ${p.since}〜${p.until}
リーチ合計: 現在 ${c.metrics.reach?.toLocaleString() ?? '—'}（前期比 ${pct(d.reach)}）
表示回数合計: 現在 ${c.metrics.views?.toLocaleString() ?? '—'}（前期比 ${pct(d.views)}）
プロフィール訪問合計: 現在 ${c.metrics.profile_views?.toLocaleString() ?? '—'}（前期比 ${pct(d.profile_views)}）
フォロワー期間内増減（推定）: 現在 ${c.follower_start != null && c.follower_end != null ? (c.follower_end - c.follower_start).toLocaleString() : '—'}（前期との差 ${d.follower_net != null ? d.follower_net.toLocaleString() : '—'}）
投稿本数: 現在 ${c.posts.total}（前期 ${p.posts.total}、差 ${d.posts_total != null ? `${d.posts_total >= 0 ? '+' : ''}${d.posts_total}` : '—'}）
内訳 FEED/REELS/STORY: ${c.posts.feed}/${c.posts.reels}/${c.posts.story} vs ${p.posts.feed}/${p.posts.reels}/${p.posts.story}
`.trim()

  const metricsSummary = `
公開中ストーリー数（概算）: ${dashboard.freshness.active_story_count}
データ鮮度: メディア更新 ${dashboard.freshness.media_updated_at ?? '—'} / アカウントインサイト取得 ${dashboard.freshness.account_insight_fetched_at ?? '—'}
`.trim()

  const topPostsSummary = dashboard.top_posts.length
    ? dashboard.top_posts.map((post, i) => {
        const cap = (post.caption ?? '').replace(/\s+/g, ' ').slice(0, 80)
        return `${i + 1}. ${post.posted_at.slice(0, 10)} [${post.media_product_type ?? '?'}] リーチ:${post.reach ?? '—'} 保存:${post.saves ?? '—'} — ${cap}`
      }).join('\n')
    : '（該当投稿なし）'

  const demographicsSummary = dashboard.demographics.length
    ? dashboard.demographics.map(slice => {
        const head = slice.rows.slice(0, 5).map(r => `${r.label}:${r.value}`).join(', ')
        return `${slice.metric} / ${slice.breakdown}: ${head}`
      }).join('\n')
    : '（属性データなし）'

  const profileActivitySummary = dashboard.profile_activity_posts.by_action.length
    ? dashboard.profile_activity_posts.by_action.map(a => `${a.label}: ${a.value}`).join(', ')
    : '（投稿経由のプロフィール行動の集計なし）'

  const modelId: AiModelOptionId = await getAiModelIdForAccountId(supabase, accountId)

  try {
    const text = await summarizeDashboardBrief({
      username: account.username ?? 'unknown',
      periodLabel: `${periodLabel(period)}（${since}〜${until}）`,
      accountStrategy: strategyRow?.strategy_text ?? '',
      metricsSummary,
      periodCompareSummary,
      topPostsSummary,
      demographicsSummary,
      profileActivitySummary,
      modelId,
    })
    return NextResponse.json({ data: { text, period, since, until } })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI 要約の生成に失敗しました'
    console.error('[instagram/dashboard/brief]', e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
