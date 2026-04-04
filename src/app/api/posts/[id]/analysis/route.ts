export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { analyzePost } from '@/lib/claude/client'

// POST /api/posts/[id]/analysis — AI分析実行（ストリーミング）
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 投稿取得
  const { data: post, error: postError } = await supabase
    .from('ig_media')
    .select('*')
    .eq('id', id)
    .single()
  if (postError) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // 最新インサイト取得
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

  // ストリーミングレスポンス
  const stream = await analyzePost({ post, insights, promptText, accountStrategy, accountUsername })

  // バックグラウンドで結果保存（ストリームを複製することは難しいので、非ストリーミングで別途保存は省略）
  const admin = createSupabaseAdminClient()

  // Transform stream to also save to DB
  let fullText = ''
  const [stream1, stream2] = stream.tee()

  // Consume stream2 to save to DB
  ;(async () => {
    const reader = stream2.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
    }
    // Save analysis result
    await admin.from('ai_analysis_results').insert({
      account_id: post.account_id,
      analysis_type: 'post_analysis',
      media_ids: [id],
      analysis_result: fullText,
      model_used: 'claude-sonnet-4-6',
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
