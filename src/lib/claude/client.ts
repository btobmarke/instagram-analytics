import Anthropic from '@anthropic-ai/sdk'
import type { IgMedia, IgMediaInsightFact, KpiProgress, KpiMaster } from '@/types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'

// ========== 投稿単体AI分析 ==========

export async function analyzePost(params: {
  post: IgMedia
  insights: Record<string, number | null>
  promptText: string
  accountStrategy: string
  accountUsername: string
}): Promise<ReadableStream<Uint8Array>> {
  const systemPrompt = buildSystemPrompt(params.promptText, params.accountStrategy)
  const userMessage = `
以下の投稿データを分析してください：

【投稿情報】
アカウント: @${params.accountUsername}
投稿日時: ${params.post.posted_at}
投稿種別: ${params.post.media_product_type ?? params.post.media_type}
キャプション:
${params.post.caption ?? '（キャプションなし）'}

【指標値】
${Object.entries(params.insights)
  .map(([k, v]) => `${k}: ${v ?? '取得中'}`)
  .join('\n')}
`

  return streamMessage(systemPrompt, userMessage)
}

// ========== 投稿比較AI分析 ==========

export async function analyzePostComparison(params: {
  posts: Array<{ post: IgMedia; insights: Record<string, number | null> }>
  promptText: string
  accountStrategy: string
  accountUsername: string
}): Promise<ReadableStream<Uint8Array>> {
  const systemPrompt = buildSystemPrompt(params.promptText, params.accountStrategy)
  const userMessage = `
以下の${params.posts.length}件の投稿を比較分析してください：

${params.posts.map((p, i) => `
【投稿${i + 1}】
投稿日時: ${p.post.posted_at}
種別: ${p.post.media_product_type ?? p.post.media_type}
キャプション冒頭: ${(p.post.caption ?? '').slice(0, 100)}
指標値: ${JSON.stringify(p.insights)}
`).join('\n---\n')}
`

  return streamMessage(systemPrompt, userMessage)
}

// ========== 週次・月次AI分析 ==========

export async function analyzeAccount(params: {
  accountUsername: string
  period: { start: string; end: string }
  analysisType: 'weekly' | 'monthly'
  weeklySummary: Record<string, unknown>
  kpiProgress: KpiProgress[]
  kpiMasters: KpiMaster[]
  topPosts: Array<{ post: IgMedia; insights: Record<string, number | null> }>
  promptText: string
  accountStrategy: string
}): Promise<string> {
  const systemPrompt = buildSystemPrompt(params.promptText, params.accountStrategy)
  const analysisLabel = params.analysisType === 'weekly' ? '週次' : '月次'

  const userMessage = `
以下は @${params.accountUsername} の${analysisLabel}データです。${analysisLabel}評価を行ってください。

【分析期間】${params.period.start} ～ ${params.period.end}

【サマリー】
${JSON.stringify(params.weeklySummary, null, 2)}

【KPI達成状況】
${params.kpiProgress.map(p => {
  const kpi = params.kpiMasters.find(k => k.id === p.kpi_result_id)
  return `${kpi?.kpi_name ?? 'KPI'}: 実績 ${p.actual_value} / 目標 ${p.target_value} (達成率 ${p.achievement_rate?.toFixed(1)}%)`
}).join('\n')}

【パフォーマンス上位投稿】
${params.topPosts.slice(0, 5).map((p, i) =>
  `${i + 1}. ${p.post.posted_at} - リーチ: ${p.insights.reach}, エンゲージメント率: ${p.insights.engagement_rate?.toFixed(1)}%`
).join('\n')}
`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// ========== アルゴリズム情報取得 ==========

export async function fetchInstagramAlgorithmInfo(): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `現在の最新Instagramアルゴリズムの情報を調査して、マーケティング担当者が知っておくべきポイントを日本語でまとめてください。
フィード投稿、リール（Reels）、ストーリーのそれぞれについて、エンゲージメント・リーチに影響する主要な要素を具体的に説明してください。`,
    }],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// ========== 内部ユーティリティ ==========

function buildSystemPrompt(analysisPrompt: string, strategy: string): string {
  return `あなたはInstagramマーケティングの専門家です。
データに基づいて具体的・実践的なアドバイスを提供してください。

【分析観点】
${analysisPrompt}

【アカウント戦略】
${strategy || '（戦略未設定）'}`
}

async function streamMessage(systemPrompt: string, userMessage: string): Promise<ReadableStream<Uint8Array>> {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const response = await anthropic.messages.stream({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      })

      for await (const chunk of response) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
      }
      controller.close()
    },
  })

  return stream
}
