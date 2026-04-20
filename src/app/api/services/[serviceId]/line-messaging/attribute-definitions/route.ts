import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_attribute_definitions')
    .select('id, code, label, value_type, select_options, created_at, updated_at')
    .eq('service_id', serviceId)
    .order('code')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, 'code は小文字英数とアンダースコアのみ'),
  label: z.string().min(1).max(200),
  value_type: z.enum(['text', 'number', 'select']),
  select_options: z.array(z.string()).optional(),
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

  if (parsed.data.value_type === 'select') {
    const opts = parsed.data.select_options ?? []
    if (opts.length === 0) {
      return NextResponse.json({ error: 'select_options required for select type' }, { status: 422 })
    }
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_attribute_definitions')
    .insert({
      service_id: serviceId,
      code: parsed.data.code,
      label: parsed.data.label.trim(),
      value_type: parsed.data.value_type,
      select_options:
        parsed.data.value_type === 'select' ? (parsed.data.select_options ?? []) : null,
    })
    .select('id, code, label, value_type, select_options, created_at, updated_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'duplicate_attribute_code' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data })
}
