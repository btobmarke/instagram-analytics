/**
 * DELETE /api/projects/[projectId]/kpi-strategy/[planId]
 *   戦略プランを削除する
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; planId: string }> },
) {
  const { projectId, planId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { error } = await supabase
    .from('kpi_strategy_plans')
    .delete()
    .eq('id', planId)
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
