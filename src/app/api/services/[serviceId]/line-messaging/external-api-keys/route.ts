import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

const ScopeEnum = z.enum(['contacts:read', 'tags:read', 'tags:write', 'broadcast:write'])

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_external_api_keys')
    .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at')
    .eq('service_id', serviceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(ScopeEnum).min(1),
})

/**
 * POST — 平文キーを1回だけ返す（以降は保存されない）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const raw = `lm_${randomBytes(24).toString('base64url')}`
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex')
  const prefix = raw.slice(0, 12)

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_external_api_keys')
    .insert({
      service_id: serviceId,
      name: parsed.data.name.trim(),
      key_prefix: prefix,
      key_hash: hash,
      scopes: parsed.data.scopes,
    })
    .select('id, name, key_prefix, scopes, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: { ...data, api_key_plaintext: raw },
    warning: 'api_key_plaintext はこの応答でのみ表示されます。安全に保管してください。',
  })
}
