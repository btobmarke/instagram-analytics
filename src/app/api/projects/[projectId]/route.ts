import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/projects/:projectId - プロジェクト詳細取得（サービス一覧付き）
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { data, error } = await supabase
    .from('projects')
    .select(`
      id, project_name, note, is_active, created_at, updated_at, client_id,
      clients!inner(id, client_name),
      services(id, service_type, service_name, display_order, is_active, deleted_at, created_at, updated_at)
    `)
    .eq('id', projectId)
    .single()

  if (error || !data) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'プロジェクトが見つかりません' } }, { status: 404 })
  }

  const client = (data as Record<string, unknown>).clients as Record<string, unknown>
  const services = ((data as Record<string, unknown>).services as Record<string, unknown>[] ?? [])
    .filter((s: Record<string, unknown>) => s.is_active && s.deleted_at === null)
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (Number(a.display_order) - Number(b.display_order)))

  return NextResponse.json({
    success: true,
    data: {
      id: data.id,
      project_name: data.project_name,
      client_id: data.client_id,
      note: data.note,
      is_active: data.is_active,
      created_at: data.created_at,
      updated_at: data.updated_at,
      client: { id: client.id, client_name: client.client_name },
      services,
    },
  })
}
