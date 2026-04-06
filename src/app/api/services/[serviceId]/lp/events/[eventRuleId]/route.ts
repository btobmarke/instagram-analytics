import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const UpdateEventRuleSchema = z.object({
  event_name: z.string().min(1).max(255).optional(),
  intent_type: z.string().max(100).optional(),
  intent_score: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
})

/**
 * GET /api/services/:serviceId/lp/events/:eventRuleId
 * LP イベントルール詳細取得
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string; eventRuleId: string }> }
) {
  const { serviceId, eventRuleId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { data: lpSite } = await supabase.from('lp_sites').select('id').eq('service_id', serviceId).single()
  if (!lpSite) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'LPサービスが見つかりません' } }, { status: 404 })

  const { data: rule, error } = await supabase
    .from('lp_event_rules')
    .select('id, event_id, event_name, intent_type, intent_score, is_active, note, created_at, updated_at')
    .eq('id', eventRuleId)
    .eq('lp_site_id', lpSite.id)
    .single()

  if (error || !rule) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'イベントルールが見つかりません' } }, { status: 404 })
  }

  // 発火数
  const { count: fireCount } = await supabase
    .from('lp_event_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_rule_id', eventRuleId)

  return NextResponse.json({
    success: true,
    data: {
      eventRuleId: rule.id,
      eventId: rule.event_id,
      eventName: rule.event_name,
      intentType: rule.intent_type,
      intentScore: rule.intent_score,
      isActive: rule.is_active,
      note: rule.note,
      fireCount: fireCount ?? 0,
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
    },
  })
}

/**
 * PATCH /api/services/:serviceId/lp/events/:eventRuleId
 * LP イベントルール更新
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string; eventRuleId: string }> }
) {
  const { serviceId, eventRuleId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { data: lpSite } = await supabase.from('lp_sites').select('id').eq('service_id', serviceId).single()
  if (!lpSite) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'LPサービスが見つかりません' } }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = UpdateEventRuleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {}
  if (parsed.data.event_name !== undefined) updateData.event_name = parsed.data.event_name
  if (parsed.data.intent_type !== undefined) updateData.intent_type = parsed.data.intent_type
  if (parsed.data.intent_score !== undefined) updateData.intent_score = parsed.data.intent_score
  if (parsed.data.is_active !== undefined) updateData.is_active = parsed.data.is_active
  if (parsed.data.note !== undefined) updateData.note = parsed.data.note

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '更新項目がありません' } }, { status: 400 })
  }

  const { data: updated, error } = await supabase
    .from('lp_event_rules')
    .update(updateData)
    .eq('id', eventRuleId)
    .eq('lp_site_id', lpSite.id)
    .select('id, event_id, event_name, intent_type, intent_score, is_active, note, updated_at')
    .single()

  if (error || !updated) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'イベントルールが見つかりません' } }, { status: 404 })
  }

  return NextResponse.json({ success: true, data: updated })
}
