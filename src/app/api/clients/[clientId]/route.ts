import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/clients/:clientId - クライアント詳細取得（プロジェクト一覧付き）
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { data, error } = await supabase
    .from('clients')
    .select(`
      id, client_name, note, is_active, created_at, updated_at,
      projects (
        id, project_name, note, is_active, created_at, updated_at,
        services(id)
      )
    `)
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'クライアントが見つかりません' } }, { status: 404 })
  }

  const projects = ((data as Record<string, unknown>).projects as Record<string, unknown>[] ?? [])
    .filter((p: Record<string, unknown>) => p.is_active)
    .map((p: Record<string, unknown>) => ({
      id: p.id,
      project_name: p.project_name,
      note: p.note,
      is_active: p.is_active,
      created_at: p.created_at,
      updated_at: p.updated_at,
      service_count: Array.isArray(p.services) ? p.services.length : 0,
    }))

  return NextResponse.json({
    success: true,
    data: {
      id: data.id,
      client_name: data.client_name,
      note: data.note,
      is_active: data.is_active,
      created_at: data.created_at,
      updated_at: data.updated_at,
      projects,
    },
  })
}
