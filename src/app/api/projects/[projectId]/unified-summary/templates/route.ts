import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ── バリデーションスキーマ ─────────────────────────────────────────────────────

const CreateSchema = z.object({
  name:        z.string().min(1).max(100),
  time_unit:   z.enum(['hour', 'day', 'week', 'month', 'custom_range']).default('day'),
  count:       z.number().int().positive().default(14),
  range_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  range_end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  rows:        z.array(z.any()).default([]),
})

// ── GET /api/projects/[projectId]/unified-summary/templates ──────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { data, error } = await supabase
    .from('project_summary_templates')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: data ?? [] })
}

// ── POST /api/projects/[projectId]/unified-summary/templates ─────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      { status: 400 },
    )
  }

  const { name, time_unit, count, range_start, range_end, rows } = parsed.data

  const { data, error } = await supabase
    .from('project_summary_templates')
    .insert({
      project_id:  projectId,
      name,
      time_unit,
      count,
      range_start: range_start ?? null,
      range_end:   range_end   ?? null,
      rows,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}
