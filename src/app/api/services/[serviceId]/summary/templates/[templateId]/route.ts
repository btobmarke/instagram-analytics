import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ── バリデーションスキーマ ──────────────────────────────
const UpdateSchema = z.object({
  name:         z.string().min(1).max(100).optional(),
  time_unit:    z.enum(['hour', 'day', 'week', 'month']).optional(),
  rows:         z.array(z.any()).optional(),
  custom_cards: z.array(z.any()).optional(),
})

type Params = { params: Promise<{ serviceId: string; templateId: string }> }

// ── DB行 → クライアント向け camelCase 変換 ────────────
function toTemplate(row: Record<string, unknown>) {
  return {
    id:          row.id,
    serviceId:   row.service_id,
    name:        row.name,
    timeUnit:    row.time_unit,
    rows:        row.rows         ?? [],
    customCards: row.custom_cards ?? [],
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}

// ── 共通: テンプレート取得（serviceId で所有確認）────
async function findTemplate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string,
  templateId: string,
) {
  return supabase
    .from('summary_templates')
    .select('*')
    .eq('id', templateId)
    .eq('service_id', serviceId)   // service 所有チェック兼用
    .single()
}

// ── GET /api/services/[serviceId]/summary/templates/[templateId] ──
export async function GET(
  _req: NextRequest,
  { params }: Params,
) {
  const { serviceId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { data, error } = await findTemplate(supabase, serviceId, templateId)
  if (error || !data) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'テンプレートが見つかりません' } },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, data: toTemplate(data) })
}

// ── PUT /api/services/[serviceId]/summary/templates/[templateId] ──
export async function PUT(
  req: NextRequest,
  { params }: Params,
) {
  const { serviceId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  // 存在チェック
  const { data: existing } = await findTemplate(supabase, serviceId, templateId)
  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'テンプレートが見つかりません' } },
      { status: 404 },
    )
  }

  // リクエストボディ検証
  const body = await req.json().catch(() => ({}))
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      { status: 400 },
    )
  }

  // undefined フィールドは除外してパッチ
  const patch: Record<string, unknown> = {}
  if (parsed.data.name         !== undefined) patch.name         = parsed.data.name
  if (parsed.data.time_unit    !== undefined) patch.time_unit    = parsed.data.time_unit
  if (parsed.data.rows         !== undefined) patch.rows         = parsed.data.rows
  if (parsed.data.custom_cards !== undefined) patch.custom_cards = parsed.data.custom_cards

  const { data, error } = await supabase
    .from('summary_templates')
    .update(patch)
    .eq('id', templateId)
    .select()
    .single()

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: toTemplate(data) })
}

// ── DELETE /api/services/[serviceId]/summary/templates/[templateId] ──
export async function DELETE(
  _req: NextRequest,
  { params }: Params,
) {
  const { serviceId, templateId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  // 存在チェック
  const { data: existing } = await findTemplate(supabase, serviceId, templateId)
  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'テンプレートが見つかりません' } },
      { status: 404 },
    )
  }

  const { error } = await supabase
    .from('summary_templates')
    .delete()
    .eq('id', templateId)

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: null })
}
