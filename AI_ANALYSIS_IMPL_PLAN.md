# Instagram AI分析機能 実装計画書

> 作成日: 2026-04-09  
> 対象リポジトリ: `instagram-analytics_repo`  
> 実装ツール: Cursor  
> フェーズ: ② 週次/月次レポート → ③ 投稿単体AIアドバイス → ① AIチャット

---

## 0. 現状の把握

### すでに存在するもの（活用できる資産）

| ファイル | 内容 |
|---|---|
| `src/lib/claude/client.ts` | Anthropic SDK を直接使ったストリーミング実装。`analyzePost` / `analyzeAccount` など |
| `src/app/api/posts/[id]/analysis/route.ts` | 投稿単体AI分析APIルート（ReadableStream返却） |
| `src/app/api/analytics/ai/route.ts` | 週次/月次AI分析APIルート（非ストリーミング） |
| `src/app/api/batch/ai-analysis/route.ts` | 週次AI分析バッチ |
| `ai_analysis_results` テーブル | 分析結果のDB保存先 |
| `analysis_prompt_settings` テーブル | 分析プロンプト設定 |
| `account_strategy_settings` テーブル | アカウント戦略文章 |

### 現状の問題点

- `analyzeAccount` は **非ストリーミング**（全文生成後にレスポンス）→ UXが悪い
- `analyzePost` は **ReadableStream の手動管理** が必要 → フロントが複雑
- AI分析タブが Instagram サービス詳細ページに **存在しない**
- チャット機能は **未実装**

---

## 1. Vercel AI SDK 導入方針

### なぜ切り替えるか

現状の `@anthropic-ai/sdk` 直接利用は低レベルAPIを手で扱う必要があり、ストリーミングのフロント実装が複雑。  
Vercel AI SDK（`ai` + `@ai-sdk/anthropic`）に切り替えることで：

- `streamText` → シンプルなストリーミング API ルート
- `useCompletion` hook → フロントのストリーミング表示が数行で書ける
- `useChat` hook → チャットUI が組み込みで完結（フェーズ①）
- Tool Calling → AIが自分でデータを取りに行ける（フェーズ①）

### インストール

```bash
npm install ai @ai-sdk/anthropic
```

> `@anthropic-ai/sdk` は削除不要（バッチ等で使用中）。  
> ただし将来的には `@ai-sdk/anthropic` に統一することを推奨。

### モデル設定（共通）

```typescript
// src/lib/ai/config.ts（新規作成）
import { anthropic } from '@ai-sdk/anthropic'

export const AI_MODEL = anthropic('claude-sonnet-4-6')
export const AI_MODEL_FAST = anthropic('claude-haiku-4-5-20251001') // コスト削減用
```

---

## 2. フェーズ② 週次/月次レポート（ストリーミング生成）

### 概要

ダッシュボードタブに「AI分析を実行」ボタンを追加。クリックすると分析レポートがリアルタイムにストリーミング表示される。過去の分析履歴も閲覧可能。

### 追加するタブ構成

現在のタブ: `ダッシュボード / 投稿一覧 / 設定 / サマリー`  
↓  
変更後: `ダッシュボード / 投稿一覧 / **AI分析** / 設定 / サマリー`

### 2-1. APIルート（新規作成）

**`src/app/api/services/[serviceId]/ai/report/route.ts`**

```typescript
// POST: レポートをストリーミング生成
import { streamText } from 'ai'
import { AI_MODEL } from '@/lib/ai/config'

export async function POST(request, { params }) {
  const { serviceId } = await params
  const { analysisType = 'weekly' } = await request.json()
  
  // 1. serviceId → accountId を解決
  // 2. 分析対象期間のデータ取得（account_insights / kpi_progress / top_posts）
  // 3. analysis_prompt_settings / account_strategy_settings を取得
  // 4. streamText で生成
  // 5. onFinish コールバックで ai_analysis_results に保存（DB保存はストリーム完了後）

  const result = streamText({
    model: AI_MODEL,
    system: systemPrompt,
    prompt: userMessage,
    onFinish: async ({ text }) => {
      await admin.from('ai_analysis_results').insert({ ... })
    },
  })

  return result.toDataStreamResponse()
}
```

> **ポイント:** `toDataStreamResponse()` を使うことで Vercel AI SDK の Data Stream Protocol に準拠したレスポンスが返り、フロントで `useCompletion` が使えるようになる。

**`src/app/api/services/[serviceId]/ai/report/route.ts`（GET: 過去履歴）**

```typescript
// 既存の /api/analytics/ai の GET ロジックを移植
// account_id を serviceId から解決して ai_analysis_results を返す
```

### 2-2. フロントページ（新規作成）

**`src/app/(dashboard)/projects/[projectId]/services/[serviceId]/instagram/ai/page.tsx`**

```tsx
'use client'
import { useCompletion } from 'ai/react'

export default function AiReportPage({ params }) {
  const { serviceId } = use(params)
  const [analysisType, setAnalysisType] = useState<'weekly' | 'monthly'>('weekly')

  const { completion, complete, isLoading } = useCompletion({
    api: `/api/services/${serviceId}/ai/report`,
  })

  const handleGenerate = () => {
    complete('', { body: { analysisType } })
  }

  return (
    <div>
      {/* タブナビ（既存コピー + AI分析をactive） */}
      
      {/* 期間選択 + 実行ボタン */}
      <div className="flex gap-3">
        <select value={analysisType} onChange={...}>
          <option value="weekly">週次分析（直近7日）</option>
          <option value="monthly">月次分析（直近30日）</option>
        </select>
        <button onClick={handleGenerate} disabled={isLoading}>
          {isLoading ? 'AI分析中...' : 'AI分析を実行'}
        </button>
      </div>

      {/* ストリーミング表示エリア */}
      {(completion || isLoading) && (
        <div className="prose">
          <MarkdownRenderer content={completion} />
          {isLoading && <BlinkingCursor />}
        </div>
      )}

      {/* 過去履歴（SWRで取得） */}
      <PastReports serviceId={serviceId} />
    </div>
  )
}
```

### 2-3. Markdownレンダラー（新規コンポーネント）

**`src/components/ai/MarkdownRenderer.tsx`**

AI の出力は Markdown 形式になるため、`react-markdown` でレンダリング。

```bash
npm install react-markdown
```

```tsx
import ReactMarkdown from 'react-markdown'

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        h2: ({ children }) => <h2 className="text-lg font-bold mt-6 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-1">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
```

### 2-4. タブナビ修正

既存の3ファイルのタブ配列に `AI分析` を追加:

- `instagram/page.tsx`（設定タブ）
- `instagram/analytics/page.tsx`（ダッシュボードタブ）
- `instagram/posts/page.tsx`（投稿一覧タブ）

```tsx
// タブ定義（共通パターン）
const tabs = [
  { label: 'ダッシュボード', href: `/projects/${projectId}/services/${serviceId}/instagram/analytics` },
  { label: '投稿一覧',       href: `/projects/${projectId}/services/${serviceId}/instagram/posts` },
  { label: 'AI分析',         href: `/projects/${projectId}/services/${serviceId}/instagram/ai` },
  { label: '設定',           href: `/projects/${projectId}/services/${serviceId}/instagram` },
  { label: 'サマリー',       href: `/projects/${projectId}/services/${serviceId}/summary` },
]
```

### 2-5. 実装ステップ（Cursor向け作業順序）

```
1. npm install ai @ai-sdk/anthropic react-markdown
2. src/lib/ai/config.ts を作成
3. src/app/api/services/[serviceId]/ai/report/route.ts を作成（POST + GET）
4. src/components/ai/MarkdownRenderer.tsx を作成
5. src/app/(dashboard)/projects/[projectId]/services/[serviceId]/instagram/ai/page.tsx を作成
6. 既存タブ3ファイル（analytics/page.tsx, posts/page.tsx, instagram/page.tsx）にAI分析タブを追加
```

---

## 3. フェーズ③ 投稿単体AIアドバイス

### 概要

投稿一覧タブの各投稿カードに「✨ AI分析」ボタンを追加。クリックすると投稿詳細データを渡してAIがアドバイスをストリーミング表示。

### 3-1. 既存APIルートの修正

**`src/app/api/posts/[id]/analysis/route.ts`（既存を修正）**

現在 `ReadableStream` を手動で扱っているが、Vercel AI SDK の `streamText` + `toDataStreamResponse()` に置き換える。

```typescript
import { streamText } from 'ai'
import { AI_MODEL } from '@/lib/ai/config'

export async function POST(request, { params }) {
  const { id } = await params
  
  // データ取得ロジックはそのまま流用（post, insights, account, prompt, strategy）
  
  const result = streamText({
    model: AI_MODEL,
    system: systemPrompt,
    prompt: userMessage,
    onFinish: async ({ text }) => {
      await admin.from('ai_analysis_results').insert({ ... })
    },
  })

  return result.toDataStreamResponse()
}
```

### 3-2. 投稿一覧ページの修正

**`src/app/(dashboard)/projects/[projectId]/services/[serviceId]/instagram/posts/page.tsx`**

各投稿カードに AI 分析モーダルを追加。

```tsx
// AI分析モーダルコンポーネント（新規）
function PostAiModal({ postId, onClose }) {
  const { completion, complete, isLoading } = useCompletion({
    api: `/api/posts/${postId}/analysis`,
  })

  useEffect(() => {
    complete('') // モーダルを開いたら自動実行
  }, [])

  return (
    <Modal onClose={onClose}>
      <h3>✨ AI分析</h3>
      {isLoading && !completion && <LoadingSpinner />}
      <MarkdownRenderer content={completion} />
      {isLoading && <BlinkingCursor />}
    </Modal>
  )
}
```

各投稿カードに追加:
```tsx
<button onClick={() => setAnalyzingPostId(post.id)}>
  ✨ AI分析
</button>

{analyzingPostId === post.id && (
  <PostAiModal postId={post.id} onClose={() => setAnalyzingPostId(null)} />
)}
```

### 3-3. 実装ステップ（Cursor向け作業順序）

```
1. src/app/api/posts/[id]/analysis/route.ts を Vercel AI SDK に書き換え
2. src/components/ai/PostAiModal.tsx を作成（useCompletion + MarkdownRenderer）
3. posts/page.tsx に「AI分析」ボタンとモーダル呼び出しを追加
```

---

## 4. フェーズ① AIチャット（データQ&A）

### 概要

AI分析タブ内にチャットUIを追加。ユーザーが自然言語で質問すると、AIが Tool Calling でデータを取得して回答。

### 4-1. Tool定義

AIが使えるツールを定義する。

```typescript
// src/lib/ai/tools.ts（新規作成）
import { tool } from 'ai'
import { z } from 'zod'

export const instagramTools = (serviceId: string, admin: SupabaseClient) => ({

  // アカウントインサイト取得
  getAccountInsights: tool({
    description: 'アカウント全体の指標（リーチ・エンゲージメント等）を指定期間で取得する',
    parameters: z.object({
      metric_codes: z.array(z.string()).describe('取得する指標コード例: ["reach", "accounts_engaged"]'),
      since: z.string().describe('開始日 YYYY-MM-DD'),
      until: z.string().describe('終了日 YYYY-MM-DD'),
    }),
    execute: async ({ metric_codes, since, until }) => {
      // ig_account_insight_fact から取得
    },
  }),

  // 投稿パフォーマンス取得
  getTopPosts: tool({
    description: '指定期間の投稿をパフォーマンス指標でソートして取得する',
    parameters: z.object({
      metric: z.string().describe('ソート基準の指標コード例: "reach", "like_count"'),
      since: z.string(),
      until: z.string(),
      limit: z.number().default(10),
      media_type: z.enum(['FEED', 'REELS', 'STORY', 'ALL']).default('ALL'),
    }),
    execute: async ({ metric, since, until, limit, media_type }) => {
      // ig_media + ig_media_insight_fact を JOIN して取得
    },
  }),

  // KPI達成状況取得
  getKpiProgress: tool({
    description: 'KPIの目標値・実績・達成率を取得する',
    parameters: z.object({
      period: z.enum(['latest', 'monthly']).default('latest'),
    }),
    execute: async ({ period }) => {
      // kpi_progress を取得
    },
  }),

  // フォロワー推移取得
  getFollowerTrend: tool({
    description: 'フォロワー数の推移を取得する',
    parameters: z.object({
      days: z.number().default(30).describe('直近N日分'),
    }),
    execute: async ({ days }) => {
      // ig_account_insight_fact の follower_count を取得
    },
  }),
})
```

### 4-2. APIルート（新規作成）

**`src/app/api/services/[serviceId]/ai/chat/route.ts`**

```typescript
import { streamText } from 'ai'
import { AI_MODEL } from '@/lib/ai/config'
import { instagramTools } from '@/lib/ai/tools'

export async function POST(request, { params }) {
  const { serviceId } = await params
  const { messages } = await request.json()

  // serviceId → accountId を解決
  const admin = createSupabaseAdminClient()

  const result = streamText({
    model: AI_MODEL,
    system: `あなたはInstagramマーケティングの分析アシスタントです。
ユーザーの質問に対して、利用可能なツールでデータを取得した上で、
具体的・実践的な回答を日本語で提供してください。
データがない場合は正直にその旨を伝えてください。`,
    messages,
    tools: instagramTools(serviceId, admin),
    maxSteps: 5, // Tool呼び出し → 回答のループ上限
  })

  return result.toDataStreamResponse()
}
```

### 4-3. フロントUI修正

**`src/app/(dashboard)/projects/[projectId]/services/[serviceId]/instagram/ai/page.tsx`**

フェーズ②で作ったページにチャット欄を追加。タブで「レポート」と「チャット」を切り替え。

```tsx
'use client'
import { useChat } from 'ai/react'

function AiChatSection({ serviceId }) {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: `/api/services/${serviceId}/ai/chat`,
  })

  return (
    <div className="flex flex-col h-[600px]">
      {/* メッセージ一覧 */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={m.role === 'user' ? 'bg-purple-100 rounded-2xl px-4 py-2' : 'bg-gray-100 rounded-2xl px-4 py-2 max-w-2xl'}>
              <MarkdownRenderer content={m.content} />
              {/* Tool呼び出し中のインジケーター */}
              {m.toolInvocations?.map(t => (
                <span key={t.toolCallId} className="text-xs text-gray-400">
                  🔍 {t.toolName} を実行中...
                </span>
              ))}
            </div>
          </div>
        ))}
        {isLoading && <ThinkingIndicator />}
      </div>

      {/* 入力欄 */}
      <form onSubmit={handleSubmit} className="flex gap-2 pt-4 border-t">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="例: 先週のリーチが落ちた原因は？"
          className="flex-1 input"
        />
        <button type="submit" disabled={isLoading}>送信</button>
      </form>

      {/* サジェスト質問 */}
      <SuggestedQuestions onSelect={(q) => handleInputChange({ target: { value: q } })} />
    </div>
  )
}

// サジェスト質問例
const SUGGESTED_QUESTIONS = [
  '先週のパフォーマンスを総括してください',
  'エンゲージメント率が高い投稿の共通点は？',
  'フォロワーが増えている/減っている原因は？',
  '今月のKPI達成状況を教えてください',
  '次に投稿すべきコンテンツのアドバイスをください',
]
```

### 4-4. 実装ステップ（Cursor向け作業順序）

```
1. npm install zod（未インストールの場合）
2. src/lib/ai/tools.ts を作成（4つのツール定義）
3. src/app/api/services/[serviceId]/ai/chat/route.ts を作成
4. ai/page.tsx にチャットセクションを追加（タブ: レポート / チャット）
5. src/components/ai/SuggestedQuestions.tsx を作成
```

---

## 5. ファイル構成まとめ

### 新規作成ファイル

```
src/
├── lib/
│   └── ai/
│       ├── config.ts           # モデル設定
│       └── tools.ts            # Tool定義（フェーズ①）
├── components/
│   └── ai/
│       ├── MarkdownRenderer.tsx  # Markdownレンダラー
│       ├── PostAiModal.tsx       # 投稿単体AIモーダル（フェーズ③）
│       └── SuggestedQuestions.tsx # チャットのサジェスト（フェーズ①）
└── app/
    ├── api/
    │   └── services/
    │       └── [serviceId]/
    │           └── ai/
    │               ├── report/route.ts  # レポート生成API（フェーズ②）
    │               └── chat/route.ts    # チャットAPI（フェーズ①）
    └── (dashboard)/projects/[projectId]/services/[serviceId]/instagram/
        └── ai/
            └── page.tsx            # AI分析タブページ（フェーズ②③①）
```

### 修正するファイル

```
src/app/api/posts/[id]/analysis/route.ts   # Vercel AI SDK に書き換え（フェーズ③）
src/.../instagram/analytics/page.tsx       # タブにAI分析追加
src/.../instagram/posts/page.tsx           # タブ追加 + AI分析ボタン
src/.../instagram/page.tsx                 # タブにAI分析追加
```

---

## 6. DB追加不要

`ai_analysis_results` テーブルは既存のため、マイグレーション不要。

ただし `analysis_type` カラムに入る値として以下を追加で使用する:

| 値 | 説明 |
|---|---|
| `account_weekly`（既存） | 週次レポート |
| `account_monthly`（既存） | 月次レポート |
| `post_analysis`（既存） | 投稿単体AI分析 |

`triggered_by` は `'user'` で統一（既存のまま）。

---

## 7. 環境変数

新規追加なし。既存の `ANTHROPIC_API_KEY` を Vercel AI SDK が自動的に使用する。

```
# .env.local（既存）
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 8. 実装時の注意点

### Vercel AI SDK のストリームフォーマット

`toDataStreamResponse()` を使うと Data Stream Protocol（SSE）形式で返る。  
フロントで `useCompletion` / `useChat` を使う場合は **このフォーマットが前提**なので、カスタムストリームは使わないこと。

### Vercel Timeout（重要）

- Vercel Hobby: **10秒** のタイムアウト  
- Vercel Pro: **300秒**  
- `export const maxDuration = 60` を各ルートに設定すること

```typescript
export const maxDuration = 60 // Vercel Pro 前提
export const dynamic = 'force-dynamic'
```

### serviceId → accountId の解決パターン

全AIルートで共通して必要になるため、ユーティリティ関数として切り出す:

```typescript
// src/lib/ai/resolve-account.ts
export async function resolveAccountId(serviceId: string, admin: SupabaseClient) {
  const { data } = await admin
    .from('services')
    .select('type_config')
    .eq('id', serviceId)
    .single()
  return (data?.type_config as { ig_account_ref_id?: string })?.ig_account_ref_id ?? null
}
```

### フェーズ②の `analyzeAccount` 既存関数との関係

既存の `src/lib/claude/client.ts` の `analyzeAccount` は非ストリーミングで `@anthropic-ai/sdk` を使っている。  
フェーズ②では **新しいAPIルートで `streamText` を使って再実装**するため、既存の `analyzeAccount` は触らなくてよい（バッチが使っているため）。

### Tool Calling のコスト

フェーズ①のチャットは Tool Calling により1回の質問で複数のAPIコールが発生する可能性がある。  
`maxSteps: 5` で制限しているが、コストが気になる場合は `AI_MODEL_FAST`（Haiku）をチャット用に使うオプションも検討。

---

## 9. フェーズ別工数見積もり

| フェーズ | 内容 | 工数感 |
|---|---|---|
| ② | 週次/月次レポート（ストリーミング） | 半日〜1日 |
| ③ | 投稿単体AIアドバイス | 2〜3時間 |
| ① | AIチャット（Tool Calling） | 1〜2日 |

---

## 10. Cursor への引き渡し用プロンプト例

### フェーズ② 着手時

```
このリポジトリにInstagramサービスのAI分析機能（週次/月次レポートのストリーミング生成）を追加してください。
AI_ANALYSIS_IMPL_PLAN.md の「フェーズ②」セクションを参照し、「2-5. 実装ステップ」の順番で実装してください。

前提:
- npm install ai @ai-sdk/anthropic react-markdown を先に実行
- 既存の src/lib/claude/client.ts は変更しない
- Vercel AI SDK の streamText + toDataStreamResponse() を使う
- タイムアウト対策として export const maxDuration = 60 を各ルートに追加
```

### フェーズ③ 着手時

```
AI_ANALYSIS_IMPL_PLAN.md の「フェーズ③」を実装してください。
既存の src/app/api/posts/[id]/analysis/route.ts を Vercel AI SDK (streamText) に書き換え、
posts/page.tsx に PostAiModal コンポーネントを追加してください。
MarkdownRenderer は フェーズ② で作成済みのものを使い回してください。
```

### フェーズ① 着手時

```
AI_ANALYSIS_IMPL_PLAN.md の「フェーズ①」を実装してください。
src/lib/ai/tools.ts にTool定義を作成し、chat/route.ts でuseChat対応のAPIルートを作成してください。
ai/page.tsx にチャットセクションをタブ切り替えで追加し、SuggestedQuestions も実装してください。
zod は既存の package.json を確認してから install するか判断してください。
```
