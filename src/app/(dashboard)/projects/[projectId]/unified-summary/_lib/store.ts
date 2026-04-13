// ── 横断サマリーテンプレート API クライアント ────────────────────────────────

import type { ProjectSummaryTemplate, UnifiedTableRow, TimeUnit } from './types'
import { rowToTemplate } from './types'

// ── List ──────────────────────────────────────────────────────────────────────

export async function listTemplates(projectId: string): Promise<ProjectSummaryTemplate[]> {
  const res = await fetch(`/api/projects/${projectId}/unified-summary/templates`)
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return (json.data ?? []).map(rowToTemplate)
}

// ── Get single ───────────────────────────────────────────────────────────────

export async function getTemplate(
  projectId: string,
  templateId: string,
): Promise<ProjectSummaryTemplate> {
  const res = await fetch(`/api/projects/${projectId}/unified-summary/templates/${templateId}`)
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return rowToTemplate(json.data)
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createTemplate(
  projectId: string,
  payload: {
    name: string
    timeUnit?: TimeUnit
    count?: number
    rangeStart?: string | null
    rangeEnd?: string | null
    rows?: UnifiedTableRow[]
  },
): Promise<ProjectSummaryTemplate> {
  const res = await fetch(`/api/projects/${projectId}/unified-summary/templates`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name:        payload.name,
      time_unit:   payload.timeUnit   ?? 'day',
      count:       payload.count      ?? 14,
      range_start: payload.rangeStart ?? null,
      range_end:   payload.rangeEnd   ?? null,
      rows:        payload.rows       ?? [],
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return rowToTemplate(json.data)
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateTemplate(
  projectId: string,
  templateId: string,
  payload: {
    name?: string
    timeUnit?: TimeUnit
    count?: number
    rangeStart?: string | null
    rangeEnd?: string | null
    rows?: UnifiedTableRow[]
  },
): Promise<ProjectSummaryTemplate> {
  const body: Record<string, unknown> = {}
  if (payload.name      !== undefined) body.name        = payload.name
  if (payload.timeUnit  !== undefined) body.time_unit   = payload.timeUnit
  if (payload.count     !== undefined) body.count       = payload.count
  if (payload.rangeStart !== undefined) body.range_start = payload.rangeStart
  if (payload.rangeEnd   !== undefined) body.range_end   = payload.rangeEnd
  if (payload.rows       !== undefined) body.rows        = payload.rows

  const res = await fetch(
    `/api/projects/${projectId}/unified-summary/templates/${templateId}`,
    {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return rowToTemplate(json.data)
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteTemplate(projectId: string, templateId: string): Promise<void> {
  const res = await fetch(
    `/api/projects/${projectId}/unified-summary/templates/${templateId}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(await res.text())
}
