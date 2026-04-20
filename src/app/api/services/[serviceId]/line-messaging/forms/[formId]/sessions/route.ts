import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string; formId: string }> }

const PostSchema = z.object({
  line_user_id: z.string().min(1).max(128).optional(),
  utm: z.record(z.string(), z.string()).optional(),
  /** セッション有効期限（日数、省略時 30） */
  ttl_days: z.number().int().min(1).max(90).optional(),
})

/**
 * POST .../forms/[formId]/sessions — 回答用セッション（公開 URL に付与する token）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId, formId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = PostSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: form, error: fErr } = await admin
    .from('line_messaging_forms')
    .select('id')
    .eq('id', formId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (fErr || !form) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const publicToken = randomBytes(24).toString('hex')
  const ttl = parsed.data.ttl_days ?? 30
  const expiresAt = new Date(Date.now() + ttl * 86400 * 1000).toISOString()

  const utm: Record<string, string> = {}
  if (parsed.data.utm) {
    for (const [k, v] of Object.entries(parsed.data.utm)) {
      if (typeof v === 'string' && v.length <= 500) utm[k] = v
    }
  }

  const { data: session, error: sErr } = await admin
    .from('line_messaging_form_sessions')
    .insert({
      form_id: formId,
      public_token: publicToken,
      line_user_id: parsed.data.line_user_id?.trim() ?? null,
      utm,
      expires_at: expiresAt,
    })
    .select('id, public_token, expires_at, utm')
    .single()

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')

  const public_path = `/f/${serviceId}/${formId}?t=${publicToken}`

  return NextResponse.json({
    success: true,
    data: {
      ...session,
      public_url: base ? `${base}${public_path}` : public_path,
    },
  })
}
