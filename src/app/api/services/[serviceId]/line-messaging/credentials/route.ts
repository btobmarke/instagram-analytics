import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/utils/crypto'

type Params = { params: Promise<{ serviceId: string }> }

const BodySchema = z.object({
  channel_secret: z.string().min(1, 'channel_secret は必須です'),
  channel_access_token: z.string().min(1, 'channel_access_token は必須です'),
})

/**
 * GET /api/services/[serviceId]/line-messaging/credentials
 * Messaging API 認証が設定済みか（シークレットは返さない）
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: service, error: svcErr } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()

  if (svcErr || !service) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (service.service_type !== 'line') {
    return NextResponse.json({ error: 'not_a_line_service' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('line_messaging_service_credentials')
    .select('id, updated_at')
    .eq('service_id', serviceId)
    .maybeSingle()

  return NextResponse.json({
    success: true,
    data: {
      configured: !!row,
      updated_at: row?.updated_at ?? null,
    },
  })
}

/**
 * POST /api/services/[serviceId]/line-messaging/credentials
 * Channel secret と long-lived channel access token を暗号化して保存（upsert）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: service, error: svcErr } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()

  if (svcErr || !service) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (service.service_type !== 'line') {
    return NextResponse.json({ error: 'not_a_line_service' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const channelSecretEnc = encrypt(parsed.data.channel_secret.trim())
  const tokenEnc = encrypt(parsed.data.channel_access_token.trim())

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_service_credentials')
    .upsert(
      {
        service_id: serviceId,
        channel_secret_enc: channelSecretEnc,
        channel_access_token_enc: tokenEnc,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'service_id' },
    )
    .select('id, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}
