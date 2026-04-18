import Anthropic from '@anthropic-ai/sdk'
import type { IgMedia, IgMediaInsightFact, KpiProgress, KpiMaster } from '@/types'
import { normalizeAiModelId, type AiModelOptionId } from '@/lib/ai/model-options'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ========== 投稿単体AI分析 ==========

export async function analyzePost(params: {
  post: IgMedia
  insights: Record<string, number | null>
  promptText: string
  accountStrategy: string
  accountUsername: string
  /** マイルストーン・メタ・比較差分など（任意） */
  extraContext?: string
  /** Anthropic model id（省略時は Sonnet 4.6） */
  modelId?: AiModelOptionId
}): Promise<ReadableStream<Uint8Array>> {
  const systemPrompt = buildSystemPrompt(params.promptText, params.accountStrategy)
  const extra = params.extraContext?.trim()
    ? `\n【追加コンテキスト（システム生成・初速・比較用）】\n${params.extraContext.trim()}\n`
    : ''
  const userMessage = `
以下の投稿データを分析してください：
${extra}
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

  const model = normalizeAiModelId(params.modelId)
  return streamMessage(systemPrompt, userMessage, model)
}

// ========== 投稿比較AI分析 ==========

export async function analyzePostComparison(params: {
  posts: Array<{ post: IgMedia; insights: Record<string, number | null> }>
  promptText: string
  accountStrategy: string
  accountUsername: string
  modelId?: AiModelOptionId
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

  const model = normalizeAiModelId(params.modelId)
  return streamMessage(systemPrompt, userMessage, model)
}

// ========== 週次・月次AI分析 ==========

export async function analyzeAccount(params: {
  accountUsername: string
  period: { start: string; end: string }
  analysisType: 'weekly' | 'monthly'
  weeklySummary: Record<string, unknown>
  /** サービス詳細 KPI（instagram_service_kpis）のプロンプト用ブロック */
  serviceKpiPromptBlock: string
  kpiProgress: KpiProgress[]
  kpiMasters: KpiMaster[]
  topPosts: Array<{ post: IgMedia; insights: Record<string, number | null> }>
  promptText: string
  accountStrategy: string
  modelId?: AiModelOptionId
}): Promise<string> {
  const systemPrompt = buildSystemPrompt(params.promptText, params.accountStrategy)
  const analysisLabel = params.analysisType === 'weekly' ? '週次' : '月次'

  const legacyKpiLines = params.kpiProgress.map((p) => {
    const kpi = params.kpiMasters.find((k) => k.id === p.kpi_result_id)
    return `${kpi?.kpi_name ?? 'KPI'}: 実績 ${p.actual_value} / 目標 ${p.target_value} (達成率 ${p.achievement_rate?.toFixed(1)}%)`
  })

  const userMessage = `
以下は @${params.accountUsername} の${analysisLabel}データです。${analysisLabel}評価を行ってください。

【分析期間】${params.period.start} ～ ${params.period.end}

【サマリー】
${JSON.stringify(params.weeklySummary, null, 2)}

【サービスKPI設定】
${params.serviceKpiPromptBlock}

【従来システムのKPI進捗（参考・kpi_progress がある場合）】
${legacyKpiLines.length > 0 ? legacyKpiLines.join('\n') : '（データなし）'}

【パフォーマンス上位投稿】
${params.topPosts.slice(0, 5).map((p, i) =>
  `${i + 1}. ${p.post.posted_at} - リーチ: ${p.insights.reach}, エンゲージメント率: ${p.insights.engagement_rate?.toFixed(1)}%`
).join('\n')}
`

  const model = normalizeAiModelId(params.modelId)
  const response = await anthropic.messages.create({
    model,
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

/** ダッシュボード用の短文要約（KPI・目標達成には言及しない） */
const DASHBOARD_BRIEF_SYSTEM = `あなたはInstagram運用の専門家です。
与えられたデータだけに基づき、日本語でダッシュボード要約を書いてください。
- 4〜8文程度。見出しは不要。
- 良い点・気づき・次に試せる一手を自然に含める。
- KPI・目標達成率・数値目標には一切触れない。
- データにないことは断定せず、「〜の可能性」などで留める。`

export async function summarizeDashboardBrief(params: {
  username: string
  periodLabel: string
  accountStrategy: string
  metricsSummary: string
  periodCompareSummary: string
  topPostsSummary: string
  demographicsSummary: string
  profileActivitySummary: string
  modelId?: AiModelOptionId
}): Promise<string> {
  const model = normalizeAiModelId(params.modelId)
  const userMessage = `
【アカウント】@${params.username}
【期間】${params.periodLabel}

【戦略メモ】
${params.accountStrategy || '（未設定）'}

【期間比較】
${params.periodCompareSummary}

【指標サマリ】
${params.metricsSummary}

【上位投稿】
${params.topPostsSummary}

【オーディエンス属性】
${params.demographicsSummary}

【投稿経由のプロフィール行動（集計）】
${params.profileActivitySummary}
`
  const response = await anthropic.messages.create({
    model,
    max_tokens: 900,
    system: DASHBOARD_BRIEF_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// ========== アルゴリズム情報取得 ==========

export async function fetchInstagramAlgorithmInfo(
  modelId?: AiModelOptionId
): Promise<string> {
  const model = normalizeAiModelId(modelId)
  const response = await anthropic.messages.create({
    model,
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

async function streamMessage(
  systemPrompt: string,
  userMessage: string,
  model: string
): Promise<ReadableStream<Uint8Array>> {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const response = await anthropic.messages.stream({
        model,
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
