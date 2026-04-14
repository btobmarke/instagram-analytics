/**
 * GET  /api/projects/[projectId]/custom-metrics  — カスタム指標一覧
 * POST /api/projects/[projectId]/custom-metrics  — カスタム指標作成
 *
 * カスタム指標は既存の service / external 指標を組み合わせた計算式。
 * 数式中の他指標参照: {{serviceId::metricRef}} 形式。
 * colKey 形式: "custom::{id}"
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { z } from 'zod'

const CreateSchema = z.object({
  name:        z.string().min(1).max(100),
  formula:     z.string().min(1).max(2000),
  unit:        z.string().max(20).optional(),
  description: z.string().max(500).optional(),
})

type RouteParams = { params: Promise<{ projectId: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { data, error } = await supabase
    .from('project_custom_metrics')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data: data ?? [] })
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('project_custom_metrics')
    .insert({
      project_id:  projectId,
      name:        parsed.data.name,
      formula:     parsed.data.formula,
      unit:        parsed.data.unit ?? null,
      description: parsed.data.description ?? null,
    })
    .select()
    .single()

  if (error) {
    const msg = error.message.includes('unique') ? '同じ名前のカスタム指標が既に存在します' : error.message
    return NextResponse.json({ success: false, error: msg }, { status: 400 })
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}
