/**
 * PUT    /api/projects/[projectId]/analysis-presets/[presetId]
 * DELETE /api/projects/[projectId]/analysis-presets/[presetId]
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const UpdateSchema = z.object({
  name:               z.string().min(1).max(60).optional(),
  targetMetricRef:    z.string().min(1).optional(),
  featureMetricRefs:  z.array(z.string()).min(1).optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; presetId: string }> },
) {
  const { projectId, presetId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json()
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  const d = parsed.data
  if (d.name               !== undefined) updates.name                = d.name
  if (d.targetMetricRef    !== undefined) updates.target_metric_ref   = d.targetMetricRef
  if (d.featureMetricRefs  !== undefined) updates.feature_metric_refs = d.featureMetricRefs

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: '更新フィールドがありません' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('project_analysis_presets')
    .update(updates)
    .eq('id', presetId)
    .eq('project_id', projectId)
    .select()
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 })

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
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; presetId: string }> },
) {
  const { projectId, presetId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { error } = await supabase
    .from('project_analysis_presets')
    .delete()
    .eq('id', presetId)
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
