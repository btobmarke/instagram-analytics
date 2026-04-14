/**
 * KPIツリーテンプレート一覧・適用
 *
 * GET  /api/projects/[projectId]/kpi-tree/templates
 * POST /api/projects/[projectId]/kpi-tree/templates  { templateKey, treeName? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

const ApplySchema = z.object({
  templateKey: z.string().min(1).max(200),
  treeName: z.string().min(1).max(100).optional().nullable(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  // project existence check (軽いガード)
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle()
  if (!project) return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 })

  const { data, error } = await supabase
    .from('kpi_tree_templates')
    .select('id, template_key, name, description, scope, target_industry, version_no, is_active, created_at, updated_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = ApplySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })

  const admin = createSupabaseAdminClient()

  const { data: treeId, error: rpcErr } = await admin.rpc('apply_kpi_tree_template', {
    p_project_id: projectId,
    p_template_key: parsed.data.templateKey,
    p_tree_name: parsed.data.treeName ?? null,
  })

  if (rpcErr) {
    return NextResponse.json({ success: false, error: rpcErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: { treeId } }, { status: 201 })
}

