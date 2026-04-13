import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ── バリデーションスキーマ ──────────────────────────────
const CreateSchema = z.object({
  name:         z.string().min(1).max(100),
  time_unit:    z.enum(['hour', 'day', 'week', 'month', 'custom_range']).default('day'),
  range_start:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  range_end:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  rows:         z.array(z.any()).default([]),
  custom_cards: z.array(z.any()).default([]),
})

// ── DB行 → クライアント向け camelCase 変換 ────────────
function toTemplate(row: Record<string, unknown>) {
  return {
    id:          row.id,
    serviceId:   row.service_id,
    name:        row.name,
    timeUnit:    row.time_unit,
    rangeStart:  row.range_start ?? null,
    rangeEnd:    row.range_end ?? null,
    rows:        row.rows         ?? [],
    customCards: row.custom_cards ?? [],
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}

// ── GET /api/services/[serviceId]/summary/templates ───
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  // サービス存在チェック
  const { data: service } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .is('deleted_at', null)
    .single()
  if (!service) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'サービスが見つかりません' } },
      { status: 404 },
    )
  }

  // テンプレート一覧取得（新しい順）
  const { data, error } = await supabase
    .from('summary_templates')
    .select('*')
    .eq('service_id', serviceId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: (data ?? []).map(toTemplate) })
}

// ── POST /api/services/[serviceId]/summary/templates ──
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  // サービス存在チェック
  const { data: service } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .is('deleted_at', null)
    .single()
  if (!service) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'サービスが見つかりません' } },
      { status: 404 },
    )
  }

  // リクエストボディ検証
  const body = await req.json().catch(() => ({}))
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      { status: 400 },
    )
  }
  if (parsed.data.time_unit === 'custom_range' && (!parsed.data.range_start || !parsed.data.range_end || parsed.data.range_start > parsed.data.range_end)) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'custom_range では range_start / range_end（YYYY-MM-DD）が必要です' } },
      { status: 400 },
    )
  }

  // テンプレート作成
  const { data, error } = await supabase
    .from('summary_templates')
    .insert({
      service_id:   serviceId,
      name:         parsed.data.name,
      time_unit:    parsed.data.time_unit,
      range_start:  parsed.data.time_unit === 'custom_range' ? parsed.data.range_start : null,
      range_end:    parsed.data.time_unit === 'custom_range' ? parsed.data.range_end : null,
      rows:         parsed.data.rows,
      custom_cards: parsed.data.custom_cards,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: toTemplate(data) }, { status: 201 })
}
