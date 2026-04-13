/**
 * PUT    /api/projects/[projectId]/kpi-tree/nodes/[nodeId]  — ノード更新
 * DELETE /api/projects/[projectId]/kpi-tree/nodes/[nodeId]  — ノード削除（子も CASCADE）
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const UpdateSchema = z.object({
  parentId:  z.string().uuid().nullable().optional(),
  label:     z.string().min(1).max(100).optional(),
  nodeType:  z.enum(['folder', 'leaf']).optional(),
  metricRef: z.string().nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; nodeId: string }> },
) {
  const { projectId, nodeId } = await params
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
  if (d.parentId  !== undefined) updates.parent_id  = d.parentId
  if (d.label     !== undefined) updates.label      = d.label
  if (d.nodeType  !== undefined) updates.node_type  = d.nodeType
  if (d.metricRef !== undefined) updates.metric_ref = d.metricRef
  if (d.serviceId !== undefined) updates.service_id = d.serviceId
  if (d.sortOrder !== undefined) updates.sort_order = d.sortOrder

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: '更新フィールドがありません' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('project_kpi_tree_nodes')
    .update(updates)
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .select()
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ success: true, data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; nodeId: string }> },
) {
  const { projectId, nodeId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { error } = await supabase
    .from('project_kpi_tree_nodes')
    .delete()
    .eq('id', nodeId)
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
