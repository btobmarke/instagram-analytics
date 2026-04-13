/**
 * GET  /api/projects/[projectId]/kpi-tree/nodes  — ツリー全体取得
 * POST /api/projects/[projectId]/kpi-tree/nodes  — ノード追加
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const CreateSchema = z.object({
  parentId:  z.string().uuid().nullable().optional(),
  label:     z.string().min(1).max(100),
  nodeType:  z.enum(['folder', 'leaf']).default('leaf'),
  metricRef: z.string().optional().nullable(),
  serviceId: z.string().uuid().optional().nullable(),
  sortOrder: z.number().int().default(0),
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
    .from('project_kpi_tree_nodes')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

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

  const body = await req.json()
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { parentId, label, nodeType, metricRef, serviceId, sortOrder } = parsed.data

  const { data, error } = await supabase
    .from('project_kpi_tree_nodes')
    .insert({
      project_id: projectId,
      parent_id:  parentId ?? null,
      label,
      node_type:  nodeType,
      metric_ref: metricRef ?? null,
      service_id: serviceId ?? null,
      sort_order: sortOrder,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data }, { status: 201 })
}
