/**
 * GET  /api/projects/[projectId]/analysis-presets  — プリセット一覧
 * POST /api/projects/[projectId]/analysis-presets  — プリセット作成
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const CreateSchema = z.object({
  name:               z.string().min(1).max(60),
  targetMetricRef:    z.string().min(1),
  featureMetricRefs:  z.array(z.string()).min(1),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { data, error } = await supabase
    .from('project_analysis_presets')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  // DB の snake_case → camelCase に変換
  const presets = (data ?? []).map(row => ({
    id:                 row.id,
    projectId:          row.project_id,
    name:               row.name,
    targetMetricRef:    row.target_metric_ref,
    featureMetricRefs:  (row.feature_metric_refs as string[]) ?? [],
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  }))

  return NextResponse.json({ success: true, data: presets })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json()
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { name, targetMetricRef, featureMetricRefs } = parsed.data

  const { data, error } = await supabase
    .from('project_analysis_presets')
    .insert({
      project_id:          projectId,
      name,
      target_metric_ref:   targetMetricRef,
      feature_metric_refs: featureMetricRefs,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: {
      id:                data.id,
      projectId:         data.project_id,
      name:              data.name,
      targetMetricRef:   data.target_metric_ref,
      featureMetricRefs: (data.feature_metric_refs as string[]) ?? [],
      createdAt:         data.created_at,
      updatedAt:         data.updated_at,
    },
  }, { status: 201 })
}
