import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const CreateClientSchema = z.object({
  client_name: z.string().min(1).max(255),
  note: z.string().max(1000).optional(),
})

// GET /api/clients - クライアント一覧取得
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('page_size') ?? 20)))
  const from = (page - 1) * pageSize

  const { data, error, count } = await supabase
    .from('clients')
    .select(`
      id, client_name, note, is_active, created_at, updated_at,
      projects(id)
    `, { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) {
    console.error('[GET /api/clients]', error)
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: 'データ取得に失敗しました' } }, { status: 500 })
  }

  const clients = (data ?? []).map((c: Record<string, unknown>) => ({
    id: c.id,
    client_name: c.client_name,
    note: c.note,
    is_active: c.is_active,
    created_at: c.created_at,
    updated_at: c.updated_at,
    project_count: Array.isArray(c.projects) ? c.projects.length : 0,
  }))

  return NextResponse.json({
    success: true,
    data: clients,
    meta: { page, pageSize, totalCount: count ?? 0 },
  })
}

// POST /api/clients - クライアント登録
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = CreateClientSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({ client_name: parsed.data.client_name, note: parsed.data.note ?? null })
    .select('id, client_name, note, is_active, created_at, updated_at')
    .single()

  if (error) {
    console.error('[POST /api/clients]', error)
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: '登録に失敗しました' } }, { status: 500 })
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}
