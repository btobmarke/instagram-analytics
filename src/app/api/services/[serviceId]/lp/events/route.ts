import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const CreateEventRuleSchema = z.object({
  event_id: z.string().min(1).max(255),
  event_name: z.string().min(1).max(255),
  intent_type: z.string().max(100).default(''),
  intent_score: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
  note: z.string().max(1000).optional(),
})

/**
 * GET /api/services/:serviceId/lp/events
 * LP イベントルール一覧取得
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { data: lpSite } = await supabase.from('lp_sites').select('id').eq('service_id', serviceId).single()
  if (!lpSite) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'LPサービスが見つかりません' } }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const isActiveParam = searchParams.get('is_active')
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('page_size') ?? 20)))
  const from = (page - 1) * pageSize

  let query = supabase
    .from('lp_event_rules')
    .select('id, event_id, event_name, intent_type, intent_score, is_active, note, created_at, updated_at', { count: 'exact' })
    .eq('lp_site_id', lpSite.id)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (isActiveParam !== null) query = query.eq('is_active', isActiveParam === 'true')

  const { data, error, count } = await query

  if (error) return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: 'データ取得に失敗しました' } }, { status: 500 })

  // 発火数を取得
  const ruleIds = (data ?? []).map(r => r.id)
  const fireCounts: Record<string, number> = {}
  if (ruleIds.length > 0) {
    const { data: logCounts } = await supabase
      .from('lp_event_logs')
      .select('event_rule_id')
      .in('event_rule_id', ruleIds)

    for (const log of logCounts ?? []) {
      if (log.event_rule_id) {
        fireCounts[log.event_rule_id] = (fireCounts[log.event_rule_id] ?? 0) + 1
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: (data ?? []).map(r => ({
      eventRuleId: r.id,
      eventId: r.event_id,
      eventName: r.event_name,
      intentType: r.intent_type,
      intentScore: r.intent_score,
      isActive: r.is_active,
      note: r.note,
      fireCount: fireCounts[r.id] ?? 0,
      createdAt: r.created_at,
    })),
    meta: { page, pageSize, totalCount: count ?? 0 },
  })
}

/**
 * POST /api/services/:serviceId/lp/events
 * LP イベントルール登録
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  const { data: lpSite } = await supabase.from('lp_sites').select('id').eq('service_id', serviceId).single()
  if (!lpSite) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'LPサービスが見つかりません' } }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = CreateEventRuleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } }, { status: 400 })
  }

  // event_id 重複チェック
  const { data: existing } = await supabase
    .from('lp_event_rules')
    .select('id')
    .eq('lp_site_id', lpSite.id)
    .eq('event_id', parsed.data.event_id)
    .single()

  if (existing) {
    return NextResponse.json({ success: false, error: { code: 'DUPLICATE_EVENT_ID', message: 'このイベントIDはすでに使用されています' } }, { status: 400 })
  }

  const { data: rule, error: insertError } = await supabase
    .from('lp_event_rules')
    .insert({
      lp_site_id: lpSite.id,
      event_id: parsed.data.event_id,
      event_name: parsed.data.event_name,
      intent_type: parsed.data.intent_type,
      intent_score: parsed.data.intent_score,
      is_active: parsed.data.is_active,
      note: parsed.data.note ?? null,
    })
    .select('id, event_id, event_name, intent_type, intent_score, is_active, note, created_at')
    .single()

  if (insertError || !rule) {
    console.error('[POST /api/services/:id/lp/events] insert error', insertError)
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: '登録に失敗しました' } }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: rule }, { status: 201 })
}
