import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'
import { seedDefaultInstagramServiceKpisIfEmpty } from '@/lib/instagram/seed-default-service-kpis'

const CardTypeSchema = z.enum(['metric_card', 'custom_card'])

const KpiInputSchema = z.object({
  phase: z.coerce.number().int(),
  kpi_name: z.string().min(1).max(200),
  target_value: z.coerce.number().int(),
  card_type: CardTypeSchema,
  card_ref: z.string().min(1).max(500),
  kpi_description: z
    .string()
    .max(2000)
    .optional()
    .transform((s) => (s ?? '').trim()),
})

const PutBodySchema = z.object({
  kpis: z.array(KpiInputSchema).max(200),
})

async function assertInstagramService(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  serviceId: string
) {
  const { data: svc, error } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()
  if (error || !svc) return { ok: false as const, status: 404 as const, message: 'サービスが見つかりません' }
  if (svc.service_type !== 'instagram') {
    return { ok: false as const, status: 400 as const, message: 'Instagram サービスではありません' }
  }
  return { ok: true as const }
}

/** GET /api/services/[serviceId]/instagram/kpis */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const gate = await assertInstagramService(supabase, serviceId)
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.message }, { status: gate.status })
  }

  await seedDefaultInstagramServiceKpisIfEmpty(supabase, serviceId)

  const { data, error } = await supabase
    .from('instagram_service_kpis')
    .select('*')
    .eq('service_id', serviceId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data ?? [] })
}

/** PUT /api/services/[serviceId]/instagram/kpis — 全件置換 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const gate = await assertInstagramService(supabase, serviceId)
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.message }, { status: gate.status })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON が不正です' }, { status: 400 })
  }

  const parsed = PutBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const { kpis } = parsed.data
  const now = new Date().toISOString()

  const catalogIds = new Set(getMetricCatalog('instagram').map((c) => c.id))
  const { data: customRows, error: customErr } = await supabase
    .from('service_custom_metrics')
    .select('id')
    .eq('service_id', serviceId)
  if (customErr) {
    return NextResponse.json({ success: false, error: customErr.message }, { status: 500 })
  }
  const customIds = new Set((customRows ?? []).map((r) => r.id))

  for (let i = 0; i < kpis.length; i++) {
    const k = kpis[i]
    const ref = k.card_ref.trim()
    if (k.card_type === 'metric_card') {
      if (!catalogIds.has(ref)) {
        return NextResponse.json(
          { success: false, error: `行 ${i + 1}: 指標値カードに存在しない ID です` },
          { status: 400 },
        )
      }
    } else if (!customIds.has(ref)) {
      return NextResponse.json(
        { success: false, error: `行 ${i + 1}: カスタム指標が見つかりません` },
        { status: 400 },
      )
    }
  }

  const { error: delErr } = await supabase.from('instagram_service_kpis').delete().eq('service_id', serviceId)
  if (delErr) {
    return NextResponse.json({ success: false, error: delErr.message }, { status: 500 })
  }

  if (kpis.length === 0) {
    return NextResponse.json({ success: true, data: [] })
  }

  const rows = kpis.map((k, i) => ({
    service_id: serviceId,
    phase: k.phase,
    kpi_name: k.kpi_name.trim(),
    target_value: k.target_value,
    card_type: k.card_type,
    card_ref: k.card_ref.trim(),
    kpi_description: k.kpi_description.trim(),
    display_order: i,
    updated_at: now,
  }))

  const { data: inserted, error: insErr } = await supabase
    .from('instagram_service_kpis')
    .insert(rows)
    .select('*')

  if (insErr) {
    return NextResponse.json({ success: false, error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: inserted ?? [] })
}
