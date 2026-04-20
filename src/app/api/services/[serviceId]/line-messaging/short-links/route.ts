import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

function publicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  )
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_short_links')
    .select('*')
    .eq('service_id', serviceId)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = publicBaseUrl()
  const enriched = (data ?? []).map((row) => ({
    ...row,
    short_url: base ? `${base}/r/${row.code}` : `/r/${row.code}`,
  }))

  return NextResponse.json({ success: true, data: enriched })
}

const PostSchema = z.object({
  name: z.string().max(200).optional(),
  target_url: z.string().url(),
  code: z
    .string()
    .min(4)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
})

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

  const code =
    parsed.data.code?.trim() ||
    randomBytes(6).toString('base64url').replace(/=/g, '').slice(0, 10)

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_short_links')
    .insert({
      service_id: serviceId,
      code,
      name: parsed.data.name?.trim() ?? null,
      target_url: parsed.data.target_url,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'duplicate_code' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const base = publicBaseUrl()
  return NextResponse.json({
    success: true,
    data: {
      ...data,
      short_url: base ? `${base}/r/${data.code}` : `/r/${data.code}`,
    },
  })
}
