/**
 * GET    /api/projects/[projectId]/custom-metrics/[metricId]  — 1件取得
 * PUT    /api/projects/[projectId]/custom-metrics/[metricId]  — 更新
 * DELETE /api/projects/[projectId]/custom-metrics/[metricId]  — 削除
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const UpdateSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  formula:     z.string().min(1).max(2000).optional(),
  unit:        z.string().max(20).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
})

type RouteParams = { params: Promise<{ projectId: string; metricId: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { projectId, metricId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { data, error } = await supabase
    .from('project_custom_metrics')
    .select('*')
    .eq('id', metricId)
    .eq('project_id', projectId)
    .single()

  if (error || !data) return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ success: true, data })
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { projectId, metricId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.name        !== undefined) updates.name        = parsed.data.name
  if (parsed.data.formula     !== undefined) updates.formula     = parsed.data.formula
  if (parsed.data.unit        !== undefined) updates.unit        = parsed.data.unit
  if (parsed.data.description !== undefined) updates.description = parsed.data.description

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: '更新するフィールドがありません' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('project_custom_metrics')
    .update(updates)
    .eq('id', metricId)
    .eq('project_id', projectId)
    .select()
    .single()

  if (error) {
    const msg = error.message.includes('unique') ? '同じ名前のカスタム指標が既に存在します' : error.message
    return NextResponse.json({ success: false, error: msg }, { status: 400 })
  }

  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { projectId, metricId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { error } = await supabase
    .from('project_custom_metrics')
    .delete()
    .eq('id', metricId)
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
