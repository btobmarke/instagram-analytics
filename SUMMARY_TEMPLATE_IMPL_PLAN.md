# サマリーテンプレート 本実装計画

> **このファイルの目的**: コンテキストが途切れても次のセッションがここを読めば即実装再開できる。
> 完了したステップには `[x]` を付けていくこと。

## 全体マップ

```
Step 1  [DB]      014_summary_templates.sql マイグレーション作成
Step 2  [API]     /api/services/[serviceId]/summary/templates/route.ts (GET・POST)
Step 3  [API]     /api/services/[serviceId]/summary/templates/[templateId]/route.ts (GET・PUT・DELETE)
Step 4  [Store]   summary/_lib/store.ts を localStorage → fetch に差し替え
Step 5  [Front]   summary/page.tsx を async 対応
Step 6  [Front]   summary/[templateId]/page.tsx を async 対応
Step 7  [Front]   summary/[templateId]/view/page.tsx を async 対応
Step 8  [確認]    TypeScript ビルドチェック
```

---

## 前提知識（新セッション向け）

- リポジトリ: `/sessions/nifty-clever-pasteur/mnt/instagram-analytics_repo`
- Supabase サーバークライアント: `import { createSupabaseServerClient } from '@/lib/supabase/server'`
- APIレスポンス形式: `{ success: true, data: ... }` / `{ success: false, error: { code, message } }`
- 認証チェック: 全 API ルートで `supabase.auth.getUser()` → 未認証は 401
- サービス所有確認: `services` テーブルに対象 `serviceId` が存在するかチェック（既存パターン）
- Zod: `import { z } from 'zod'` でバリデーション

---

## Step 1: DBマイグレーション

**ファイル**: `supabase/migrations/014_summary_templates.sql` (新規作成)

```sql
-- サマリーテンプレートテーブル
CREATE TABLE IF NOT EXISTS summary_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  time_unit    TEXT        NOT NULL DEFAULT 'day',
  rows         JSONB       NOT NULL DEFAULT '[]',
  custom_cards JSONB       NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at 自動更新（既存関数を流用）
CREATE TRIGGER update_summary_templates_updated_at
  BEFORE UPDATE ON summary_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- インデックス（service_id で絞り込むクエリが多い）
CREATE INDEX idx_summary_templates_service_id ON summary_templates(service_id);

-- RLS（既存パターンと統一: 認証済みユーザーは全アクセス可）
ALTER TABLE summary_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on summary_templates"
  ON summary_templates
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

**確認**: Supabase ダッシュボードまたは `supabase db push` で適用後、テーブルが存在すること。

---

## Step 2: API テンプレート一覧・作成

**ファイル**: `src/app/api/services/[serviceId]/summary/templates/route.ts` (新規作成)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ── バリデーションスキーマ ──────────────────────────────
const CreateSchema = z.object({
  name:         z.string().min(1).max(100),
  time_unit:    z.enum(['hour', 'day', 'week', 'month']).default('day'),
  rows:         z.array(z.any()).default([]),
  custom_cards: z.array(z.any()).default([]),
})

// ── GET /api/services/[serviceId]/summary/templates ──
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  // サービス存在チェック
  const { data: service } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .is('deleted_at', null)
    .single()
  if (!service) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  // テンプレート一覧取得
  const { data, error } = await supabase
    .from('summary_templates')
    .select('*')
    .eq('service_id', serviceId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data.map(toTemplate) })
}

// ── POST /api/services/[serviceId]/summary/templates ──
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const { data: service } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .is('deleted_at', null)
    .single()
  if (!service) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('summary_templates')
    .insert({
      service_id:   serviceId,
      name:         parsed.data.name,
      time_unit:    parsed.data.time_unit,
      rows:         parsed.data.rows,
      custom_cards: parsed.data.custom_cards,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: toTemplate(data) }, { status: 201 })
}

// ── DB行 → SummaryTemplate 変換 ──────────────────────
function toTemplate(row: Record<string, unknown>) {
  return {
    id:          row.id,
    serviceId:   row.service_id,
    name:        row.name,
    timeUnit:    row.time_unit,
    rows:        row.rows ?? [],
    customCards: row.custom_cards ?? [],
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}
```

**確認**: `curl -X GET http://localhost:3000/api/services/{serviceId}/summary/templates` が `{ success: true, data: [] }` を返すこと。

---

## Step 3: API テンプレート取得・更新・削除

**ファイル**: `src/app/api/services/[serviceId]/summary/templates/[templateId]/route.ts` (新規作成)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const UpdateSchema = z.object({
  name:         z.string().min(1).max(100).optional(),
  time_unit:    z.enum(['hour', 'day', 'week', 'month']).optional(),
  rows:         z.array(z.any()).optional(),
  custom_cards: z.array(z.any()).optional(),
})

type Params = { params: Promise<{ serviceId: string; templateId: string }> }

// ── 共通: テンプレート取得＋オーナーチェック ──────────
async function fetchTemplate(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, serviceId: string, templateId: string) {
  return supabase
    .from('summary_templates')
    .select('*')
    .eq('id', templateId)
    .eq('service_id', serviceId)
    .single()
}

function toTemplate(row: Record<string, unknown>) {
  return {
    id:          row.id,
    serviceId:   row.service_id,
    name:        row.name,
    timeUnit:    row.time_unit,
    rows:        row.rows ?? [],
    customCards: row.custom_cards ?? [],
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}

// ── GET /api/services/[serviceId]/summary/templates/[templateId] ──
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const { data, error } = await fetchTemplate(supabase, serviceId, templateId)
  if (error || !data) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 })

  return NextResponse.json({ success: true, data: toTemplate(data) })
}

// ── PUT /api/services/[serviceId]/summary/templates/[templateId] ──
export async function PUT(req: NextRequest, { params }: Params) {
  const { serviceId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  // 存在確認
  const { data: existing } = await fetchTemplate(supabase, serviceId, templateId)
  if (!existing) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, { status: 400 })
  }

  // undefined キーを除いてパッチ
  const patch: Record<string, unknown> = {}
  if (parsed.data.name         !== undefined) patch.name         = parsed.data.name
  if (parsed.data.time_unit    !== undefined) patch.time_unit    = parsed.data.time_unit
  if (parsed.data.rows         !== undefined) patch.rows         = parsed.data.rows
  if (parsed.data.custom_cards !== undefined) patch.custom_cards = parsed.data.custom_cards

  const { data, error } = await supabase
    .from('summary_templates')
    .update(patch)
    .eq('id', templateId)
    .select()
    .single()

  if (error) return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  return NextResponse.json({ success: true, data: toTemplate(data) })
}

// ── DELETE /api/services/[serviceId]/summary/templates/[templateId] ──
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { serviceId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const { data: existing } = await fetchTemplate(supabase, serviceId, templateId)
  if (!existing) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 })

  const { error } = await supabase
    .from('summary_templates')
    .delete()
    .eq('id', templateId)

  if (error) return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  return NextResponse.json({ success: true, data: null })
}
```

**確認**: POST でテンプレート作成後、GET で取得でき、PUT で更新、DELETE で削除できること。

---

## Step 4: store.ts 差し替え

**ファイル**: `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/store.ts` (全面書き換え)

> ポイント: 関数シグネチャは `async` になるが、引数・戻り値の型は同じ。

```typescript
// Supabase API ベースのストア（localStorage モックからの差し替え）

import type { SummaryTemplate, StoredTemplateRow, MetricCard, TimeUnit } from './types'

// ── DB行 → SummaryTemplate 変換 ──────────────────────
function toTemplate(row: Record<string, unknown>): SummaryTemplate {
  return {
    id:          row.id as string,
    serviceId:   row.serviceId as string,
    name:        row.name as string,
    timeUnit:    row.timeUnit as TimeUnit,
    rows:        (row.rows ?? []) as StoredTemplateRow[],
    customCards: (row.customCards ?? []) as MetricCard[],
    createdAt:   row.createdAt as string,
    updatedAt:   row.updatedAt as string,
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error?.message ?? 'API error')
  return json.data as T
}

// ── CRUD ────────────────────────────────────────────────────────

/** サービスに紐づくテンプレート一覧を取得 */
export async function listTemplates(serviceId: string): Promise<SummaryTemplate[]> {
  const rows = await apiFetch<Record<string, unknown>[]>(
    `/api/services/${serviceId}/summary/templates`,
  )
  return rows.map(toTemplate)
}

/** テンプレートを1件取得 */
export async function getTemplate(templateId: string, serviceId: string): Promise<SummaryTemplate | null> {
  try {
    const row = await apiFetch<Record<string, unknown>>(
      `/api/services/${serviceId}/summary/templates/${templateId}`,
    )
    return toTemplate(row)
  } catch {
    return null
  }
}

/** テンプレートを新規作成 */
export async function createTemplate(params: {
  serviceId: string
  name: string
  timeUnit?: TimeUnit
  rows?: StoredTemplateRow[]
  customCards?: MetricCard[]
}): Promise<SummaryTemplate> {
  const row = await apiFetch<Record<string, unknown>>(
    `/api/services/${params.serviceId}/summary/templates`,
    {
      method: 'POST',
      body: JSON.stringify({
        name:         params.name,
        time_unit:    params.timeUnit    ?? 'day',
        rows:         params.rows        ?? [],
        custom_cards: params.customCards ?? [],
      }),
    },
  )
  return toTemplate(row)
}

/** テンプレートを更新 */
export async function updateTemplate(
  templateId: string,
  serviceId: string,
  patch: Partial<Pick<SummaryTemplate, 'name' | 'timeUnit' | 'rows' | 'customCards'>>,
): Promise<SummaryTemplate | null> {
  try {
    const row = await apiFetch<Record<string, unknown>>(
      `/api/services/${serviceId}/summary/templates/${templateId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          name:         patch.name,
          time_unit:    patch.timeUnit,
          rows:         patch.rows,
          custom_cards: patch.customCards,
        }),
      },
    )
    return toTemplate(row)
  } catch {
    return null
  }
}

/** テンプレートを削除 */
export async function deleteTemplate(templateId: string, serviceId: string): Promise<void> {
  await apiFetch(
    `/api/services/${serviceId}/summary/templates/${templateId}`,
    { method: 'DELETE' },
  )
}
```

> **注意**: `getTemplate` と `updateTemplate` と `deleteTemplate` のシグネチャに `serviceId` 引数が追加される。
> 呼び出し側 (Step 5〜7) でこの引数を渡すよう修正が必要。

---

## Step 5: summary/page.tsx を async 対応

**ファイル**: `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/page.tsx`

**変更箇所のみ記載:**

### (a) `reload` 関数を async 化

```typescript
// 変更前
const reload = useCallback(() => {
  setTemplates(listTemplates(serviceId))
}, [serviceId])

// 変更後
const reload = useCallback(async () => {
  const tmpl = await listTemplates(serviceId)
  setTemplates(tmpl)
}, [serviceId])
```

### (b) `handleCreate` 関数を async 化

```typescript
// 変更前
const handleCreate = () => {
  if (!newName.trim()) return
  const tmpl = createTemplate({ serviceId, name: newName.trim() })
  setNewName('')
  setShowCreateModal(false)
  router.push(`/projects/${projectId}/services/${serviceId}/summary/${tmpl.id}`)
}

// 変更後
const handleCreate = async () => {
  if (!newName.trim()) return
  const tmpl = await createTemplate({ serviceId, name: newName.trim() })
  setNewName('')
  setShowCreateModal(false)
  router.push(`/projects/${projectId}/services/${serviceId}/summary/${tmpl.id}`)
}
```

### (c) `handleDelete` 関数を async 化・serviceId 追加

```typescript
// 変更前
const handleDelete = (id: string) => {
  deleteTemplate(id)
  reload()
  setDeleting(null)
}

// 変更後
const handleDelete = async (id: string) => {
  await deleteTemplate(id, serviceId)
  await reload()
  setDeleting(null)
}
```

---

## Step 6: summary/[templateId]/page.tsx を async 対応

**ファイル**: `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/[templateId]/page.tsx`

### (a) params から serviceId も取得

```typescript
// 変更前
const { projectId, serviceId } = use(params)  // params型に serviceId がない場合は追加
// ※ このページの params は { projectId, serviceId, templateId } を持つ

// 確認: page.tsx の先頭 use(params) 部分を確認して serviceId が含まれているか確認
```

### (b) テンプレート読み込みを async 化

`useEffect` 内の `getTemplate(templateId)` を以下に変更:

```typescript
// 変更前
useEffect(() => {
  const tmpl = getTemplate(templateId)
  if (!tmpl) { router.push(`/projects/${projectId}/services/${serviceId}/summary`); return }
  setTemplate(tmpl)
  setTemplateName(tmpl.name)
  setTimeUnit(tmpl.timeUnit)
  setRows(tmpl.rows.map(...))
  setCustomCards(tmpl.customCards)
}, [templateId, ...])

// 変更後
useEffect(() => {
  getTemplate(templateId, serviceId).then(tmpl => {
    if (!tmpl) { router.push(`/projects/${projectId}/services/${serviceId}/summary`); return }
    setTemplate(tmpl)
    setTemplateName(tmpl.name)
    setTimeUnit(tmpl.timeUnit)
    setRows(tmpl.rows.map(...))
    setCustomCards(tmpl.customCards)
  })
}, [templateId, serviceId, ...])
```

### (c) handleSave を async 化・serviceId 追加

```typescript
// 変更前
const handleSave = useCallback(() => {
  setSaveState('saving')
  const storedRows = ...
  updateTemplate(templateId, { name: templateName, timeUnit, rows: storedRows, customCards })
  setSaveState('saved')
  setIsDirty(false)
  setTimeout(() => setSaveState('idle'), 2000)
}, [...])

// 変更後
const handleSave = useCallback(async () => {
  setSaveState('saving')
  const storedRows = ...
  await updateTemplate(templateId, serviceId, { name: templateName, timeUnit, rows: storedRows, customCards })
  setSaveState('saved')
  setIsDirty(false)
  setTimeout(() => setSaveState('idle'), 2000)
}, [...])
```

---

## Step 7: summary/[templateId]/view/page.tsx を async 対応

**ファイル**: `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/[templateId]/view/page.tsx`

### (a) params から serviceId 取得を確認

### (b) テンプレート読み込みを async 化

```typescript
// 変更前
useEffect(() => {
  const tmpl = getTemplate(templateId)
  if (!tmpl) { router.push(...); return }
  setTemplate(tmpl)
}, [templateId, ...])

// 変更後
useEffect(() => {
  getTemplate(templateId, serviceId).then(tmpl => {
    if (!tmpl) { router.push(...); return }
    setTemplate(tmpl)
  })
}, [templateId, serviceId, ...])
```

---

## Step 8: 最終確認

```bash
cd /path/to/repo
npx tsc --noEmit 2>&1 | grep -v "\.next/types"
```

**期待値**: Step 実施前から存在していた 2件のエラーのみ。新規エラーゼロ。

- `lp/page.tsx(192)`: `'"newKey"' is not assignable to type '"lpCode" | "snippet"'` → 既存
- `api/batch/line-oam-daily/route.ts(75)`: Supabase 型キャストエラー → 既存

---

## 注意事項・落とし穴

1. **`getTemplate` のシグネチャ変更**: 第2引数 `serviceId` が追加される。呼び出し箇所を漏れなく修正する。

2. **`[templateId]/page.tsx` の `params` 型**: このページの URL は `/projects/[projectId]/services/[serviceId]/summary/[templateId]` なので `serviceId` はセグメントに含まれている。`use(params)` から取れるはず。取れない場合は `useParams()` を使う。

3. **マイグレーション適用**: `supabase/migrations/014_summary_templates.sql` を作成しても、Supabase に適用しないと API が 500 エラーになる。`supabase db push` または Supabase ダッシュボードの SQL Editor で手動実行。

4. **`toTemplate` のキー名**: API レスポンスは `camelCase` (serviceId, timeUnit 等) で返すよう Step 2・3 で `toTemplate()` が変換している。store.ts 側の `toTemplate` もそれに合わせて `row.serviceId` 等を参照している。

5. **ローディング状態**: 現状の `summary/page.tsx` は `useEffect` + `setTemplates` で非同期になっても動作する。ただし初回表示に一瞬空の状態が見える。気になる場合は `isLoading` state を追加する（オプション対応）。

---

## 進捗チェックボックス

- [x] Step 1: 014_summary_templates.sql 作成
- [x] Step 2: templates/route.ts (GET・POST) 作成
- [x] Step 3: templates/[templateId]/route.ts (GET・PUT・DELETE) 作成
- [x] Step 4: store.ts 差し替え
- [x] Step 5: summary/page.tsx async 対応
- [x] Step 6: summary/[templateId]/page.tsx async 対応
- [x] Step 7: summary/[templateId]/view/page.tsx async 対応
- [x] Step 8: TypeScript ビルドチェック ✅ 新規エラーなし
