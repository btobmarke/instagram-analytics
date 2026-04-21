import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isAiModelOptionId } from '@/lib/ai/model-options'
import { normalizeLpMaIpExcludeList } from '@/lib/lp-ip-exclude'

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
      id, client_name, note, is_active, ai_model, lp_ma_ip_exclude_cidr, created_at, updated_at,
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
      ai_model: (data as { ai_model?: string }).ai_model ?? 'claude-sonnet-4-6',
      lp_ma_ip_exclude_cidr: normalizeStoredCidrs((data as { lp_ma_ip_exclude_cidr?: unknown }).lp_ma_ip_exclude_cidr),
      created_at: data.created_at,
      updated_at: data.updated_at,
      projects,
    },
  })
}

// PATCH /api/clients/:clientId — AI モデルなどクライアント設定の更新
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { ai_model, lp_ma_ip_exclude_cidr } = body as {
    ai_model?: string
    lp_ma_ip_exclude_cidr?: unknown
  }

  if (ai_model !== undefined) {
    if (!isAiModelOptionId(ai_model)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_MODEL', message: '無効な ai_model です' } },
        { status: 400 }
      )
    }
  }

  let normalizedCidrs: string[] | undefined
  if (lp_ma_ip_exclude_cidr !== undefined) {
    const parsed = normalizeLpMaIpExcludeList(lp_ma_ip_exclude_cidr)
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CIDR_LIST', message: parsed.message } },
        { status: 400 }
      )
    }
    normalizedCidrs = parsed.cidrs
  }

  if (ai_model === undefined && lp_ma_ip_exclude_cidr === undefined) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: '更新フィールドがありません' } },
      { status: 400 }
    )
  }

  const patch: Record<string, unknown> = {}
  if (ai_model !== undefined) patch.ai_model = ai_model
  if (normalizedCidrs !== undefined) patch.lp_ma_ip_exclude_cidr = normalizedCidrs

  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', clientId)
    .select('id, ai_model, lp_ma_ip_exclude_cidr')
    .single()

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, data })
}

function normalizeStoredCidrs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}
