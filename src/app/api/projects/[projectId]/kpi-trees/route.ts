/**
 * GET  /api/projects/[projectId]/kpi-trees  — ツリー一覧取得
 * POST /api/projects/[projectId]/kpi-trees  — ツリー新規作成
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const CreateSchema = z.object({
  name: z.string().min(1).max(100).default('新規ツリー'),
})

function isMissingRelationError(message: string): boolean {
  // Supabase(PostgREST) 経由だと表現が揺れるので、文字列でゆるく判定
  return (
    message.includes('relation') &&
    (message.includes('kpi_trees') || message.includes('kpi_validation_periods') || message.includes('project_kpi_tree_nodes'))
  )
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { data, error } = await supabase
    .from('kpi_trees')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[kpi-trees] GET failed', { projectId, error: error.message })
    return dbErrorResponse(error.message)
  }

  return NextResponse.json({ success: true, data: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('kpi_trees')
    .insert({ project_id: projectId, name: parsed.data.name })
    .select()
    .single()

  if (error) {
    console.error('[kpi-trees] POST failed', { projectId, error: error.message })
    return dbErrorResponse(error.message)
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}
