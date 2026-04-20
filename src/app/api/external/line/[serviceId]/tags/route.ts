import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateExternalApiKey, requireScope } from '@/lib/line/external-api-auth'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const admin = createSupabaseAdminClient()

  const auth = await validateExternalApiKey(admin, serviceId, req.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!requireScope(auth.scopes, 'tags:read')) {
    return NextResponse.json({ error: 'insufficient_scope' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('line_messaging_tags')
    .select('id, name, color')
    .eq('service_id', serviceId)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  name: z.string().min(1).max(200),
  color: z.string().max(32).optional(),
})

export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const admin = createSupabaseAdminClient()

  const auth = await validateExternalApiKey(admin, serviceId, req.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!requireScope(auth.scopes, 'tags:write')) {
    return NextResponse.json({ error: 'insufficient_scope' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const { data, error } = await admin
    .from('line_messaging_tags')
    .insert({
      service_id: serviceId,
      name: parsed.data.name.trim(),
      color: parsed.data.color?.trim() ?? null,
    })
    .select('id, name, color')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'duplicate_tag_name' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data })
}
