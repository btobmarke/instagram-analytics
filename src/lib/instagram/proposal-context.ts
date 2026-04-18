import type { SupabaseClient } from '@supabase/supabase-js'
import type { IgMedia } from '@/types'
import { buildInstagramServiceKpiPromptBlock } from '@/lib/ai/instagram-service-kpis-for-prompt'

export type ProposalPeriodPreset = '7d' | '30d' | '90d' | 'custom'

function addDays(isoDate: string, delta: number): string {
  const d = new Date(isoDate + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export function resolveProposalDateRange(
  preset: ProposalPeriodPreset,
  customSince?: string,
  customUntil?: string,
): { since: string; until: string } {
  const until = new Date().toISOString().slice(0, 10)
  if (preset === 'custom' && customSince && customUntil) {
    return { since: customSince.slice(0, 10), until: customUntil.slice(0, 10) }
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  return { since: addDays(until, -days), until }
}

function foldLatestInsights(
  rows: Array<{ metric_code: string; value: number | null; snapshot_at: string }>,
): Record<string, number | null> {
  const newestByMetric: Record<string, { value: number | null; snapshot_at: string }> = {}
  for (const ins of rows) {
    const prev = newestByMetric[ins.metric_code]
    if (!prev || ins.snapshot_at > prev.snapshot_at) {
      newestByMetric[ins.metric_code] = { value: ins.value, snapshot_at: ins.snapshot_at }
    }
  }
  const latest: Record<string, number | null> = {}
  for (const [code, row] of Object.entries(newestByMetric)) {
    latest[code] = row.value
  }
  return latest
}

const SUM_METRICS = [
  'reach',
  'views',
  'profile_views',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'saves',
  'shares',
] as const

function isAggregateDailyRow(row: { dimension_code: string | null }): boolean {
  return !row.dimension_code || row.dimension_code === ''
}

async function sumAccountMetrics(
  supabase: SupabaseClient,
  accountId: string,
  since: string,
  until: string,
  metricCodes: readonly string[],
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('ig_account_insight_fact')
    .select('metric_code, value, dimension_code')
    .eq('account_id', accountId)
    .in('metric_code', [...metricCodes])
    .gte('value_date', since)
    .lte('value_date', until)

  const sums: Record<string, number> = {}
  for (const code of metricCodes) sums[code] = 0
  for (const row of data ?? []) {
    if (!isAggregateDailyRow(row)) continue
    const v = row.value
    if (typeof v !== 'number') continue
    if (sums[row.metric_code] === undefined) sums[row.metric_code] = 0
    sums[row.metric_code] += v
  }
  return sums
}

/**
 * 提案資料用 LLM に渡す要約テキスト（トークン節約のため数値中心）
 */
export async function buildInstagramProposalDigest(
  supabase: SupabaseClient,
  accountId: string,
  range: { since: string; until: string },
): Promise<string> {
  const { since, until } = range

  const { data: account } = await supabase
    .from('ig_accounts')
    .select('username')
    .eq('id', accountId)
    .single()

  const username = account?.username ?? 'unknown'

  const sums = await sumAccountMetrics(supabase, accountId, since, until, SUM_METRICS)

  const { data: postsInRange } = await supabase
    .from('ig_media')
    .select('id, media_product_type')
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .gte('posted_at', `${since}T00:00:00.000Z`)
    .lte('posted_at', `${until}T23:59:59.999Z`)

  const byType: Record<string, number> = { FEED: 0, REELS: 0, STORY: 0, AD: 0, OTHER: 0 }
  for (const p of postsInRange ?? []) {
    const t = p.media_product_type ?? 'OTHER'
    const k = t in byType ? t : 'OTHER'
    byType[k] = (byType[k] ?? 0) + 1
  }
  const postTotal = (postsInRange ?? []).length

  const { data: topMediaRows } = await supabase
    .from('ig_media')
    .select(
      `
      *,
      ig_media_insight_fact(metric_code, value, snapshot_at)
    `,
    )
    .eq('account_id', accountId)
    .gte('posted_at', `${since}T00:00:00.000Z`)
    .lte('posted_at', `${until}T23:59:59.999Z`)
    .eq('is_deleted', false)
    .order('posted_at', { ascending: false })
    .limit(8)

  const topPosts = (topMediaRows ?? []).map((row) => {
    const raw = row as IgMedia & {
      ig_media_insight_fact?: Array<{
        metric_code: string
        value: number | null
        snapshot_at: string
      }>
    }
    const { ig_media_insight_fact: facts, ...post } = raw
    const insights = foldLatestInsights(facts ?? [])
    return { post: post as IgMedia, insights }
  })

  const kpiBlock = await buildInstagramServiceKpiPromptBlock(supabase, accountId, true)

  const lines: string[] = []
  lines.push(`分析期間: ${since} ～ ${until}`)
  lines.push(`アカウント: @${username}`)
  lines.push('')
  lines.push('【期間内の投稿本数】')
  lines.push(`合計: ${postTotal}（FEED ${byType.FEED} / REELS ${byType.REELS} / STORY ${byType.STORY}）`)
  lines.push('')
  lines.push('【アカウント指標の期間合計（日次・集計行のみ）】')
  for (const m of SUM_METRICS) {
    const v = sums[m]
    if (v === undefined || v === 0) continue
    lines.push(`- ${m}: ${v.toLocaleString('ja-JP')}`)
  }
  lines.push('')
  lines.push('【サービスKPI設定】')
  lines.push(kpiBlock)
  lines.push('')
  lines.push('【期間内の新着投稿ハイライト（最大8件・最新順）】')
  for (let i = 0; i < topPosts.length; i++) {
    const { post, insights } = topPosts[i]
    const cap = (post.caption ?? '').replace(/\s+/g, ' ').slice(0, 120)
    lines.push(`${i + 1}. ${post.posted_at} | ${post.media_product_type ?? post.media_type} | リーチ ${insights.reach ?? '—'} | いいね ${insights.likes ?? '—'}`)
    if (cap) lines.push(`   キャプション抜粋: ${cap}${post.caption && post.caption.length > 120 ? '…' : ''}`)
  }

  return lines.join('\n')
}
