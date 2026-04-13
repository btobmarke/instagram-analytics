import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ── バリデーションスキーマ ─────────────────────────────────────────────────────

const UpdateSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  time_unit:   z.enum(['hour', 'day', 'week', 'month', 'custom_range']).optional(),
  count:       z.number().int().positive().optional(),
  range_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  range_end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  rows:        z.array(z.any()).optional(),
})

// ── 共通: テンプレート取得＋権限確認 ─────────────────────────────────────────

async function getTemplateOrError(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  templateId: string,
) {
  const { data, error } = await supabase
    .from('project_summary_templates')
    .select('*')
    .eq('id', templateId)
    .eq('project_id', projectId)
    .single()

  if (error || !data) {
    return { template: null, err: 'NOT_FOUND' as const }
  }
  return { template: data, err: null }
}

// ── GET /api/projects/[projectId]/unified-summary/templates/[templateId] ─────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> },
) {
  const { projectId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { template, err } = await getTemplateOrError(supabase, projectId, templateId)
  if (err) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'テンプレートが見つかりません' } },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, data: template })
}

// ── PUT /api/projects/[projectId]/unified-summary/templates/[templateId] ─────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> },
) {
  const { projectId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { template: existing, err } = await getTemplateOrError(supabase, projectId, templateId)
  if (err) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'テンプレートが見つかりません' } },
      { status: 404 },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      { status: 400 },
    )
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.name        !== undefined) updates.name        = parsed.data.name
  if (parsed.data.time_unit   !== undefined) updates.time_unit   = parsed.data.time_unit
  if (parsed.data.count       !== undefined) updates.count       = parsed.data.count
  if (parsed.data.range_start !== undefined) updates.range_start = parsed.data.range_start
  if (parsed.data.range_end   !== undefined) updates.range_end   = parsed.data.range_end
  if (parsed.data.rows        !== undefined) updates.rows        = parsed.data.rows

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: true, data: existing })
  }

  const { data, error } = await supabase
    .from('project_summary_templates')
    .update(updates)
    .eq('id', templateId)
    .eq('project_id', projectId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data })
}

// ── DELETE /api/projects/[projectId]/unified-summary/templates/[templateId] ──

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> },
) {
  const { projectId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { err } = await getTemplateOrError(supabase, projectId, templateId)
  if (err) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'テンプレートが見つかりません' } },
      { status: 404 },
    )
  }

  const { error } = await supabase
    .from('project_summary_templates')
    .delete()
    .eq('id', templateId)
    .eq('project_id', projectId)

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
