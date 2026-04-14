/**
 * DELETE /api/projects/[projectId]/kpi-weights/[versionId]
 *   重みバージョンを削除する（関連する戦略プランも CASCADE 削除）
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; versionId: string }> },
) {
  const { projectId, versionId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { error } = await supabase
    .from('kpi_weight_versions')
    .delete()
    .eq('id', versionId)
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
