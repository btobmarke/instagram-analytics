/**
 * GET    /api/projects/[projectId]/kpi-trees/[treeId]  — 1件取得
 * PUT    /api/projects/[projectId]/kpi-trees/[treeId]  — 名前変更
 * DELETE /api/projects/[projectId]/kpi-trees/[treeId]  — 削除
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const UpdateSchema = z.object({
  name: z.string().min(1).max(100),
})

type RouteParams = { params: Promise<{ projectId: string; treeId: string }> }

function isMissingRelationError(message: string): boolean {
  return message.includes('relation') && message.includes('kpi_trees')
}

function dbErrorResponse(errorMessage: string) {
  if (isMissingRelationError(errorMessage)) {
    return NextResponse.json(
      {
        success: false,
        error: 'DB_SCHEMA_NOT_READY',
        hint_ja: 'KPIツリー用のDBマイグレーションが未適用の可能性があります。Supabase の migrations を適用してください（例: 032_kpi_trees.sql）。',
        detail: errorMessage,
      },
      { status: 503 }
    )
  }
  return NextResponse.json({ success: false, error: errorMessage }, { status: 500 })
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { projectId, treeId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { data, error } = await supabase
    .from('kpi_trees')
    .select('*')
    .eq('id', treeId)
    .eq('project_id', projectId)
    .single()

  if (error) {
    console.error('[kpi-trees] GET(tree) failed', { projectId, treeId, error: error.message })
    return dbErrorResponse(error.message)
  }
  if (!data) return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ success: true, data })
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { projectId, treeId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('kpi_trees')
    .update({ name: parsed.data.name })
    .eq('id', treeId)
    .eq('project_id', projectId)
    .select()
    .single()

  if (error) {
    console.error('[kpi-trees] PUT failed', { projectId, treeId, error: error.message })
    return dbErrorResponse(error.message)
  }
  if (!data) return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { projectId, treeId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  // 紐づくプリセット（→ kpi_weight_versions → kpi_strategy_plans）は CASCADE で削除される
  // kpi_validation_periods も CASCADE で削除される
  const { error } = await supabase
    .from('kpi_trees')
    .delete()
    .eq('id', treeId)
    .eq('project_id', projectId)

  if (error) {
    console.error('[kpi-trees] DELETE failed', { projectId, treeId, error: error.message })
    return dbErrorResponse(error.message)
  }

  return NextResponse.json({ success: true })
}
