/**
 * POST /api/projects/[projectId]/kpi-tree/ai-generate
 *
 * プロジェクトに紐づく実指標値・外生変数・トレンドをもとに
 * AI が最適な KPI ツリー構造を提案・保存する。
 *
 * ★ ポイント: AI に UUID を渡さず、metricId（例: ig_account.reach）と
 *   serviceName（例: "公式アカウント"）だけ返させる。
 *   サーバー側で svcMap を検索して実際の service_id に変換するため、
 *   ドロップダウンが自動選択された状態で保存される。
 *
 * Body:
 *   {
 *     goal?:     string   // ユーザーの目標（自由記述）
 *     replace?:  boolean  // true = 既存ツリーを全削除して新規作成
 *     days?:     number   // 参照期間（日数、default: 30）
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const BodySchema = z.object({
  goal:    z.string().max(500).optional(),
  replace: z.boolean().default(false),
  days:    z.number().int().min(7).max(90).default(30),
})

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** AI が返すノード形式（UUID 不使用） */
interface AiTreeNode {
  label:       string
  metricId:    string | null   // カタログの metric.id（例: ig_account.reach）
  serviceName: string | null   // サービス名ヒント
  children?:   AiTreeNode[]
}

// ── 統計ユーティリティ ─────────────────────────────────────────────────────────

function calcStats(values: number[]): {
  avg: number; latest: number; max: number; min: number; trend: '↑' | '↓' | '→'
} | null {
  if (values.length === 0) return null
  const avg    = values.reduce((s, v) => s + v, 0) / values.length
  const latest = values[values.length - 1]
  const max    = Math.max(...values)
  const min    = Math.min(...values)

  const half   = Math.floor(values.length / 2)
  const first  = values.slice(0, half).reduce((s, v) => s + v, 0) / (half || 1)
  const second = values.slice(half).reduce((s, v) => s + v, 0) / (values.length - half || 1)
  const change = first > 0 ? (second - first) / first : 0
  const trend  = change > 0.05 ? '↑' : change < -0.05 ? '↓' : '→'

  return {
    avg:    Math.round(avg * 10) / 10,
    latest: Math.round(latest * 10) / 10,
    max:    Math.round(max * 10) / 10,
    min:    Math.round(min * 10) / 10,
    trend,
  }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n * 10) / 10)
}

// ── メインハンドラ ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { goal, replace, days } = parsed.data

  const endDate   = new Date()
  const startDate = new Date(endDate.getTime() - days * 86400_000)
  const startStr  = startDate.toISOString().slice(0, 10)
  const endStr    = endDate.toISOString().slice(0, 10)

  // ── 1. プロジェクト情報 ──────────────────────────────────────────────────────
  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single()

  // ── 2. サービス一覧 ──────────────────────────────────────────────────────────
  const { data: services } = await supabase
    .from('services')
    .select('id, name, service_type')
    .eq('project_id', projectId)

  const svcList = services ?? []

  // serviceId → { name, serviceType, catalog } のマップ
  const svcMap = new Map(
    svcList.map(s => [
      s.id as string,
      {
        name:        s.name as string,
        serviceType: s.service_type as string,
        catalog:     getMetricCatalog(s.service_type as string),
      },
    ])
  )

  // ── 3. 実指標値を取得（過去 N 日間） ─────────────────────────────────────────
  const serviceIds = svcList.map(s => s.id as string)

  const { data: metricsRows } = serviceIds.length > 0
    ? await supabase
        .from('project_metrics_daily')
        .select('service_id, metric_ref, date, value')
        .eq('project_id', projectId)
        .in('service_id', serviceIds)
        .gte('date', startStr)
        .lte('date', endStr)
        .order('date', { ascending: true })
    : { data: [] }

  // service_id::metric_ref → 日付順の値配列
  const metricsMap = new Map<string, number[]>()
  for (const row of metricsRows ?? []) {
    const key = `${row.service_id}::${row.metric_ref}`
    if (!metricsMap.has(key)) metricsMap.set(key, [])
    if (row.value != null) metricsMap.get(key)!.push(row.value as number)
  }

  // ── 4. 外生変数を取得 ────────────────────────────────────────────────────────
  const { data: extRows } = await supabase
    .from('project_external_daily')
    .select('date, is_holiday, temperature_max, temperature_min, precipitation_mm')
    .eq('project_id', projectId)
    .gte('date', startStr)
    .lte('date', endStr)
    .order('date', { ascending: true })

  const extTempsMax  = (extRows ?? []).map(r => r.temperature_max as number | null).filter((v): v is number => v != null)
  const extTempsMin  = (extRows ?? []).map(r => r.temperature_min as number | null).filter((v): v is number => v != null)
  const extPrecip    = (extRows ?? []).map(r => r.precipitation_mm as number | null).filter((v): v is number => v != null)
  const holidayCount = (extRows ?? []).filter(r => r.is_holiday).length
  const extDataDays  = (extRows ?? []).length

  // ── 5. 指標ごとの統計を組み立て ──────────────────────────────────────────────
  interface MetricEntry {
    metricId:   string    // カタログの metric.id（例: ig_account.reach）
    svcId:      string
    svcName:    string
    label:      string
    category:   string
    stats:      ReturnType<typeof calcStats>
  }

  const metricEntries: MetricEntry[] = []

  for (const [svcId, { name: svcName, catalog }] of svcMap) {
    for (const metric of catalog) {
      const colKey = `${svcId}::${metric.id}`
      const values = metricsMap.get(colKey) ?? []
      metricEntries.push({
        metricId: metric.id,
        svcId,
        svcName,
        label:    metric.label,
        category: metric.category,
        stats:    calcStats(values),
      })
    }
  }

  const withData    = metricEntries.filter(m => m.stats !== null)
  const withoutData = metricEntries.filter(m => m.stats === null)

  // ── 6. プロンプト構築 ────────────────────────────────────────────────────────
  // AI には UUID を渡さず、metricId（カタログID）とサービス名だけ渡す

  const svcSection = svcList
    .map(s => `- サービス名="${s.name}"（タイプ: ${s.service_type}）`)
    .join('\n') || '（なし）'

  const metricsWithDataSection = withData.length > 0
    ? withData.map(m =>
        `  metricId="${m.metricId}" | サービス名="${m.svcName}" | ${m.label} [${m.category}]` +
        ` | 直近値=${fmtNum(m.stats!.latest)} 平均=${fmtNum(m.stats!.avg)}` +
        ` 最大=${fmtNum(m.stats!.max)} 最小=${fmtNum(m.stats!.min)} トレンド=${m.stats!.trend}`
      ).join('\n')
    : '（実績データなし）'

  const metricsNoDataSection = withoutData.length > 0
    ? withoutData
        .slice(0, 30)
        .map(m => `  metricId="${m.metricId}" | サービス名="${m.svcName}" | ${m.label} [${m.category}]`)
        .join('\n')
    : '（なし）'

  const extSection = extDataDays > 0
    ? [
        `  参照日数: ${extDataDays}日`,
        extTempsMax.length > 0
          ? `  最高気温: 平均 ${calcStats(extTempsMax)?.avg ?? '—'}℃ | metricId="external.temperature_max"`
          : null,
        extTempsMin.length > 0
          ? `  最低気温: 平均 ${calcStats(extTempsMin)?.avg ?? '—'}℃ | metricId="external.temperature_min"`
          : null,
        extPrecip.length > 0
          ? `  降水量: 平均 ${calcStats(extPrecip)?.avg ?? '—'}mm | metricId="external.precipitation_mm"`
          : null,
        `  祝日: ${holidayCount}日 | metricId="external.is_holiday"`,
        `  天気コード | metricId="external.weather_code"`,
      ].filter(Boolean).join('\n')
    : '（外生変数データなし）'

  const prompt = `
あなたは KPI ツリー設計の専門家です。
以下のプロジェクトの【実際の指標データ】と【外生変数データ】をもとに、データドリブンな KPI ツリーを JSON で提案してください。

## プロジェクト情報
名前: ${project?.name ?? projectId}
分析期間: ${startStr} 〜 ${endStr}（${days}日間）
${goal ? `ユーザーの目標: ${goal}` : ''}

## 接続サービス
${svcSection}

## 実データあり指標（優先して使用してください）
${metricsWithDataSection}

## カタログ定義のみ（実データなし）
実データあり指標で不足する場合のみ使用してください。
${metricsNoDataSection}

## 外生変数（天気・祝日）
${extSection}

## 出力形式
必ず以下の JSON のみを返してください。説明文・コードブロックは不要です。

- metricId には上記リストの metricId の値をそのまま設定してください（例: "ig_account.reach", "external.temperature_max"）
- serviceName には上記リストのサービス名（例: "公式アカウント"）をそのまま設定してください
- 外生変数の場合は serviceName を null にしてください
- 指標を紐づけないノードは metricId と serviceName を null にしてください

{
  "tree": [
    {
      "label": "ノードのラベル（日本語）",
      "metricId": "ig_account.reach",
      "serviceName": "公式アカウント",
      "children": [
        {
          "label": "子ノードのラベル",
          "metricId": "ig_feed.impressions",
          "serviceName": "公式アカウント",
          "children": []
        }
      ]
    }
  ]
}

## KPI ツリー設計方針
- ルートノード: 最終目標 KPI（例: エンゲージメント、リーチ、売上）
- 第 2 層: ルートを構成する中間指標（複数）
- 第 3 層: さらに細かい構成要素
- 深さは最大 3 階層
- 実データがある指標を優先してノードに配置する
- トレンド（↑↓→）や絶対値の大小を考慮して「注目すべき指標」をツリーの上位に配置する
- 外生変数（天気・祝日）は影響を与えると考えられる場合のみ末端ノードに追加する
- 多重共線性を避けるため、強く相関しそうな指標は同じ階層に並べない
- ノード数は全体で 5〜15 個程度が理想
`.trim()

  // ── 7. AI 呼び出し ───────────────────────────────────────────────────────────
  let aiTreeJson: { tree: AiTreeNode[] } | null = null

  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3000,
      messages:   [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // JSON ブロックまたはオブジェクトを抽出
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ??
                      text.match(/(\{[\s\S]*\})/)
    if (jsonMatch) {
      aiTreeJson = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
    }
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: `AI 生成に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    }, { status: 500 })
  }

  if (!aiTreeJson?.tree) {
    return NextResponse.json({ success: false, error: 'AI が有効な JSON を返しませんでした' }, { status: 500 })
  }

  // ── 8. metricId + serviceName → 実際の (service_id, metric_ref) に変換 ──────
  /**
   * AI が返した metricId と serviceName から実際の service_id を特定する。
   *
   * 優先順位:
   *   1. serviceName が一致 かつ metricId がそのカタログに存在
   *   2. serviceName 不問で metricId がいずれかのカタログに存在（フォールバック）
   *
   * 外生変数 (external.xxx) は serviceId = null のまま metric_ref に設定する。
   */
  function resolveMetric(
    metricId: string | null,
    serviceName: string | null,
  ): { serviceId: string | null; metricRef: string | null } {
    if (!metricId) return { serviceId: null, metricRef: null }

    // 外生変数
    if (metricId.startsWith('external.')) {
      return { serviceId: null, metricRef: metricId }
    }

    // サービス名一致優先
    if (serviceName) {
      for (const [svcId, { name, catalog }] of svcMap) {
        const nameMatch =
          name === serviceName ||
          name.includes(serviceName) ||
          serviceName.includes(name)
        if (nameMatch && catalog.find(m => m.id === metricId)) {
          return { serviceId: svcId, metricRef: metricId }
        }
      }
    }

    // フォールバック: サービス名不問でカタログ検索
    for (const [svcId, { catalog }] of svcMap) {
      if (catalog.find(m => m.id === metricId)) {
        return { serviceId: svcId, metricRef: metricId }
      }
    }

    // 一致なし（metricId だけ保存、service_id は null）
    return { serviceId: null, metricRef: metricId }
  }

  // ── 9. 既存ツリー削除（replace=true の場合）──────────────────────────────────
  if (replace) {
    await supabase
      .from('project_kpi_tree_nodes')
      .delete()
      .eq('project_id', projectId)
  }

  // ── 10. ツリーを DB に保存 ────────────────────────────────────────────────────
  async function insertNode(node: AiTreeNode, parentId: string | null, sortOrder: number): Promise<void> {
    const { serviceId, metricRef } = resolveMetric(node.metricId, node.serviceName)

    const { data: inserted } = await supabase
      .from('project_kpi_tree_nodes')
      .insert({
        project_id: projectId,
        parent_id:  parentId,
        sort_order: sortOrder,
        label:      node.label,
        node_type:  node.children && node.children.length > 0 ? 'folder' : 'leaf',
        metric_ref: metricRef,
        service_id: serviceId,
      })
      .select('id')
      .single()

    if (inserted && node.children) {
      for (let i = 0; i < node.children.length; i++) {
        await insertNode(node.children[i], inserted.id, i)
      }
    }
  }

  for (let i = 0; i < aiTreeJson.tree.length; i++) {
    await insertNode(aiTreeJson.tree[i], null, i)
  }

  // ── 11. 保存後ツリーを返す ───────────────────────────────────────────────────
  const { data: newNodes } = await supabase
    .from('project_kpi_tree_nodes')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({
    success: true,
    data: {
      aiTree:     aiTreeJson.tree,
      nodes:      newNodes ?? [],
      dataPoints: withData.length,
      period:     { start: startStr, end: endStr, days },
    },
  })
}
