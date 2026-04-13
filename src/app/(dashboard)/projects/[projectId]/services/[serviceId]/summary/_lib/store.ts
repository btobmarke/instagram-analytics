// Supabase API ベースのストア
// localStorage モックからの差し替え版
// インターフェースは同じ（async 化のみ変更）

import type { SummaryTemplate, StoredTemplateRow, MetricCard, TimeUnit } from './types'

// ── API レスポンスの camelCase 行 → SummaryTemplate ─
function toTemplate(row: Record<string, unknown>): SummaryTemplate {
  return {
    id:          row.id          as string,
    serviceId:   row.serviceId   as string,
    name:        row.name        as string,
    timeUnit:    row.timeUnit    as TimeUnit,
    rangeStart:  (row.rangeStart ?? null) as string | null,
    rangeEnd:    (row.rangeEnd ?? null) as string | null,
    rows:        (row.rows        ?? []) as StoredTemplateRow[],
    customCards: (row.customCards ?? []) as MetricCard[],
    createdAt:   row.createdAt   as string,
    updatedAt:   row.updatedAt   as string,
  }
}

// ── 共通フェッチヘルパー ───────────────────────────────
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const json = await res.json()
  if (!json.success) {
    throw new Error(json.error?.message ?? `API error: ${res.status}`)
  }
  return json.data as T
}

// ── CRUD ─────────────────────────────────────────────

/** サービスに紐づくテンプレート一覧を取得 */
export async function listTemplates(serviceId: string): Promise<SummaryTemplate[]> {
  const rows = await apiFetch<Record<string, unknown>[]>(
    `/api/services/${serviceId}/summary/templates`,
  )
  return rows.map(toTemplate)
}

/** テンプレートを1件取得 */
export async function getTemplate(
  templateId: string,
  serviceId: string,
): Promise<SummaryTemplate | null> {
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
  rangeStart?: string | null
  rangeEnd?: string | null
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
        range_start:  params.rangeStart ?? undefined,
        range_end:    params.rangeEnd ?? undefined,
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
  patch: Partial<Pick<SummaryTemplate, 'name' | 'timeUnit' | 'rows' | 'customCards' | 'rangeStart' | 'rangeEnd'>>,
): Promise<SummaryTemplate | null> {
  try {
    const row = await apiFetch<Record<string, unknown>>(
      `/api/services/${serviceId}/summary/templates/${templateId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          name:         patch.name,
          time_unit:    patch.timeUnit,
          range_start:  patch.rangeStart,
          range_end:    patch.rangeEnd,
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
export async function deleteTemplate(
  templateId: string,
  serviceId: string,
): Promise<void> {
  await apiFetch(
    `/api/services/${serviceId}/summary/templates/${templateId}`,
    { method: 'DELETE' },
  )
}
