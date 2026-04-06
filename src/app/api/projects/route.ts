import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const CreateProjectSchema = z.object({
  client_id: z.string().uuid(),
  project_name: z.string().min(1).max(255),
  note: z.string().max(1000).optional(),
})

// GET /api/projects - プロジェクト一覧取得
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('page_size') ?? 20)))
  const from = (page - 1) * pageSize

  let query = supabase
    .from('projects')
    .select(`
      id, project_name, note, is_active, created_at, updated_at, client_id,
      clients!inner(id, client_name),
      services(id)
    `, { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (clientId) query = query.eq('client_id', clientId)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/projects]', error)
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: 'データ取得に失敗しました' } }, { status: 500 })
  }

  const projects = (data ?? []).map((p: Record<string, unknown>) => {
    const client = p.clients as Record<string, unknown>
    return {
      id: p.id,
      project_name: p.project_name,
      client_id: p.client_id,
      client_name: client?.client_name ?? '',
      note: p.note,
      is_active: p.is_active,
      created_at: p.created_at,
      updated_at: p.updated_at,
      service_count: Array.isArray(p.services) ? p.services.length : 0,
    }
  })

  return NextResponse.json({
    success: true,
    data: projects,
    meta: { page, pageSize, totalCount: count ?? 0 },
  })
}

// POST /api/projects - プロジェクト登録
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = CreateProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } }, { status: 400 })
  }

  // クライアント存在確認
  const { data: client } = await supabase.from('clients').select('id').eq('id', parsed.data.client_id).single()
  if (!client) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '指定されたクライアントが存在しません' } }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      client_id: parsed.data.client_id,
      project_name: parsed.data.project_name,
      note: parsed.data.note ?? null,
    })
    .select('id, project_name, client_id, note, is_active, created_at, updated_at')
    .single()

  if (error) {
    console.error('[POST /api/projects]', error)
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: '登録に失敗しました' } }, { status: 500 })
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}
