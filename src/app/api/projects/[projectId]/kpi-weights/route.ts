/**
 * GET /api/projects/[projectId]/kpi-weights
 *   重みバージョン一覧取得（preset_id で絞り込み可能）
 *
 * Query:
 *   presetId?: string
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const presetId = searchParams.get('presetId')

  let query = supabase
    .from('kpi_weight_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })

  if (presetId) query = query.eq('preset_id', presetId)

  const { data, error } = await query

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, data: data ?? [] })
}
