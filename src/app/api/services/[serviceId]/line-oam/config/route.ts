import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ serviceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('line_oam_service_configs')
    .select('*')
    .eq('service_id', serviceId)
    .single()

  return NextResponse.json({ success: true, data: data ?? null })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.bot_id) {
    return NextResponse.json({ error: 'bot_id は必須です' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_oam_service_configs')
    .upsert({
      service_id: serviceId,
      bot_id:     body.bot_id,
      is_active:  body.is_active ?? true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'service_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}
