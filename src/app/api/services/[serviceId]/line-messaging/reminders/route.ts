import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const status = req.nextUrl.searchParams.get('status') ?? 'scheduled'
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_messaging_reminders')
    .select('id, contact_id, message_text, run_at, status, last_error, created_at, updated_at')
    .eq('service_id', serviceId)
    .eq('status', status)
    .order('run_at', { ascending: true })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}

const PostSchema = z.object({
  contact_id: z.string().uuid(),
  message_text: z.string().min(1).max(5000),
  run_at: z.string().min(1),
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

  const runMs = Date.parse(parsed.data.run_at)
  if (Number.isNaN(runMs)) {
    return NextResponse.json({ error: 'invalid_run_at' }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data: contact, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('id')
    .eq('id', parsed.data.contact_id)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (cErr || !contact) return NextResponse.json({ error: 'contact_not_found' }, { status: 404 })

  const { data, error } = await admin
    .from('line_messaging_reminders')
    .insert({
      service_id: serviceId,
      contact_id: parsed.data.contact_id,
      message_text: parsed.data.message_text,
      run_at: new Date(runMs).toISOString(),
      status: 'scheduled',
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}
