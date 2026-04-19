import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { MaActionsSchema } from '@/lib/line/ma-action-types'

type Params = { params: Promise<{ serviceId: string }> }

const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug は小文字英数とハイフンのみ')

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_forms')
    .select('id, title, description, slug, enabled, created_at, updated_at')
    .eq('service_id', serviceId)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  slug: SlugSchema,
  enabled: z.boolean().optional().default(true),
  post_submit_actions: z.unknown().optional().default([]),
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

  const ap = MaActionsSchema.safeParse(parsed.data.post_submit_actions ?? [])
  if (!ap.success) {
    return NextResponse.json(
      { error: 'invalid_post_submit_actions', details: ap.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_forms')
    .insert({
      service_id: serviceId,
      title: parsed.data.title.trim(),
      description: parsed.data.description?.trim() ?? null,
      slug: parsed.data.slug,
      enabled: parsed.data.enabled,
      post_submit_actions: ap.data,
    })
    .select('id, title, description, slug, enabled, post_submit_actions, created_at, updated_at')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'duplicate_slug' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data })
}
