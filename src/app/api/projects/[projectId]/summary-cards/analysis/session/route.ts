/**
 * GET /api/projects/[projectId]/summary-cards/analysis/session?treeId=...
 *
 * 最新の分析セッション（ロック条件）を返す。
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const QuerySchema = z.object({
  treeId: z.string().uuid(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = QuerySchema.safeParse({ treeId: url.searchParams.get('treeId') })
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('summary_card_analysis_sessions')
    .select('*')
    .eq('project_id', projectId)
    .eq('kpi_tree_id', parsed.data.treeId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? null })
}

