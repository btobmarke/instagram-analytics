export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { analyzePost } from '@/lib/claude/client'
import { getAiModelIdForAccountId } from '@/lib/ai/resolve-ai-model'
import {
  buildTimeSeriesMapFromFactRows,
  milestoneCumulativeSummary,
  buildMilestoneDiffTable,
  type OverlaySeriesPost,
} from '@/lib/instagram/post-insight-chart'
import { formatPostMetaContextBlock } from '@/lib/instagram/post-meta'

// POST /api/posts/[id]/analysis — AI分析実行（ストリーミング）
// Body（任意 JSON）: { "peer_ids": ["uuid", ...] } — 最大2件。マイルストーン差分をプロンプトに含める
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let peerIds: string[] = []
  try {
    const ct = request.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const b = await request.json() as { peer_ids?: unknown }
      if (Array.isArray(b.peer_ids)) {
        peerIds = b.peer_ids.filter((x): x is string => typeof x === 'string').slice(0, 2)
      }
    }
  } catch {
    /* 本文なしでも可 */
  }

  // 投稿取得
  const { data: post, error: postError } = await supabase
    .from('ig_media')
    .select('*')
    .eq('id', id)
    .single()
  if (postError) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // 最新インサイト取得（表示用スナップショット）
  const { data: insightRows } = await supabase
    .from('ig_media_insight_fact')
    .select('metric_code, value, snapshot_at')
    .eq('media_id', id)
    .order('snapshot_at', { ascending: false })
    .limit(100)

  const insights: Record<string, number | null> = {}
  for (const row of (insightRows ?? [])) {
    if (!(row.metric_code in insights)) insights[row.metric_code] = row.value
  }

  // 時系列（マイルストーン・比較用）
  const { data: insightAsc } = await supabase
    .from('ig_media_insight_fact')
    .select('metric_code, value, snapshot_at')
    .eq('media_id', id)
    .order('snapshot_at', { ascending: true })
    .limit(3000)

  const timeSeries = buildTimeSeriesMapFromFactRows(insightAsc ?? [])
  const milestones = milestoneCumulativeSummary(post.posted_at, timeSeries, ['reach', 'likes', 'saved'])
  const metaBlock = formatPostMetaContextBlock(post)

  let peerDiffLines = ''
  for (const pid of peerIds) {
    const { data: peerPost, error: pErr } = await supabase
      .from('ig_media')
      .select('id, account_id, posted_at')
      .eq('id', pid)
      .single()
    if (pErr || !peerPost || peerPost.account_id !== post.account_id) continue

    const { data: peerFacts } = await supabase
      .from('ig_media_insight_fact')
      .select('metric_code, value, snapshot_at')
      .eq('media_id', pid)
      .order('snapshot_at', { ascending: true })
      .limit(3000)

    const peerTs = buildTimeSeriesMapFromFactRows(peerFacts ?? [])
    const mainO: OverlaySeriesPost = {
      id: post.id,
      label: 'この投稿',
      postedAtIso: post.posted_at,
      timeSeries,
    }
    const peerO: OverlaySeriesPost = {
      id: pid,
      label: `比較投稿 ${pid.slice(0, 8)}`,
      postedAtIso: peerPost.posted_at,
      timeSeries: peerTs,
    }
    const diffs = buildMilestoneDiffTable(mainO, peerO, ['reach', 'likes', 'saved'])
    const notable = diffs.filter(d => d.deltaPct != null && Math.abs(d.deltaPct) >= 10).slice(0, 12)
    if (notable.length === 0) {
      peerDiffLines += `\n【比較 ${pid.slice(0, 8)}】差分10%超のマイルストーンはなし（データ不足の可能性あり）\n`
    } else {
      peerDiffLines += `\n【比較 ${pid.slice(0, 8)}・マイルストーン差分（% は比較投稿を基準）】\n`
      peerDiffLines += notable
        .map(
          d =>
            `- ${d.milestoneLabel} / ${d.metric}: この投稿 ${d.main ?? '—'} vs 比較 ${d.peer ?? '—'}（差 ${d.delta ?? '—'}, ${d.deltaPct != null ? `${d.deltaPct.toFixed(0)}%` : '—'}）`
        )
        .join('\n')
    }
  }

  const extraContext = [
    '【投稿メタ】',
    metaBlock,
    '',
    '【マイルストーン累積（6h/24h/72h/7d）reach・likes・saved】',
    JSON.stringify(milestones, null, 2),
    peerDiffLines.trim() ? peerDiffLines : null,
  ]
    .filter(Boolean)
    .join('\n')

  // アカウント情報
  const { data: account } = await supabase
    .from('ig_accounts')
    .select('username')
    .eq('id', post.account_id)
    .single()

  // プロンプト設定取得
  const { data: promptSetting } = await supabase
    .from('analysis_prompt_settings')
    .select('prompt_text')
    .eq('prompt_type', 'post_analysis')
    .eq('is_active', true)
    .single()

  // 戦略設定取得
  const { data: strategySetting } = await supabase
    .from('account_strategy_settings')
    .select('strategy_text')
    .eq('account_id', post.account_id)
    .single()

  const promptText = promptSetting?.prompt_text ?? 'この投稿のパフォーマンスを分析してください。'
  const accountStrategy = strategySetting?.strategy_text ?? ''
  const accountUsername = account?.username ?? 'unknown'
  const modelId = await getAiModelIdForAccountId(supabase, post.account_id)

  const stream = await analyzePost({
    post,
    insights,
    promptText,
    accountStrategy,
    accountUsername,
    modelId,
    extraContext,
  })

  const admin = createSupabaseAdminClient()

  let fullText = ''
  const [stream1, stream2] = stream.tee()

  ;(async () => {
    const reader = stream2.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
    }
    await admin.from('ai_analysis_results').insert({
      account_id: post.account_id,
      analysis_type: 'post_analysis',
      media_ids: [id],
      analysis_result: fullText,
      model_used: modelId,
      triggered_by: 'user',
    })
  })()

  return new Response(stream1, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
