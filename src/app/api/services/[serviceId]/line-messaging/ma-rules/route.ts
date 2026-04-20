import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { MaActionsSchema } from '@/lib/line/ma-action-types'

type Params = { params: Promise<{ serviceId: string }> }

const KeywordRuleSchema = z.object({
  rule_kind: z.literal('keyword'),
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().min(0).max(1_000_000).optional().default(100),
  match_type: z.enum(['exact', 'contains']),
  pattern: z.string().min(1).max(500),
  reply_text: z.string().max(5000).nullable().optional(),
  actions: z.unknown().optional().default([]),
})

const FollowRuleSchema = z.object({
  rule_kind: z.literal('follow'),
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().min(0).max(1_000_000).optional().default(100),
  reply_text: z.string().max(5000).nullable().optional(),
  actions: z.unknown().optional().default([]),
})

const UnfollowRuleSchema = z.object({
  rule_kind: z.literal('unfollow'),
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().min(0).max(1_000_000).optional().default(100),
  actions: z.unknown().optional().default([]),
})

const PostRuleSchema = z.discriminatedUnion('rule_kind', [
  KeywordRuleSchema,
  FollowRuleSchema,
  UnfollowRuleSchema,
])

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_ma_rules')
    .select('*')
    .eq('service_id', serviceId)
    .order('priority', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PostRuleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const actionsParsed = MaActionsSchema.safeParse(parsed.data.actions ?? [])
  if (!actionsParsed.success) {
    return NextResponse.json(
      { error: 'invalid_actions', details: actionsParsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const insertRow: Record<string, unknown> = {
    service_id: serviceId,
    name: parsed.data.name.trim(),
    rule_kind: parsed.data.rule_kind,
    enabled: parsed.data.enabled,
    priority: parsed.data.priority,
    actions: actionsParsed.data,
  }

  if (parsed.data.rule_kind === 'keyword') {
    insertRow.match_type = parsed.data.match_type
    insertRow.pattern = parsed.data.pattern.trim()
    insertRow.reply_text = parsed.data.reply_text ?? null
  } else if (parsed.data.rule_kind === 'follow') {
    insertRow.match_type = null
    insertRow.pattern = null
    insertRow.reply_text = parsed.data.reply_text ?? null
  } else {
    insertRow.match_type = null
    insertRow.pattern = null
    insertRow.reply_text = null
  }

  const { data, error } = await admin
    .from('line_messaging_ma_rules')
    .insert(insertRow)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}
