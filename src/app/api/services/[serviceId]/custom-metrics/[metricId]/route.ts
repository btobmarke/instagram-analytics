import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FormulaNodeSchema } from '@/lib/summary/formula-zod'

const UpdateSchema = z.object({
  name:    z.string().min(1).max(100).optional(),
  formula: FormulaNodeSchema.optional(),
})

// ── PUT /api/services/[serviceId]/custom-metrics/[metricId] ──────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string; metricId: string }> },
) {
  const { serviceId, metricId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      { status: 400 },
    )
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.name    !== undefined) updates.name    = parsed.data.name
  if (parsed.data.formula !== undefined) updates.formula = parsed.data.formula

  if (Object.keys(updates).length === 0) {
    const { data } = await supabase
      .from('service_custom_metrics')
      .select('*')
      .eq('id', metricId)
      .eq('service_id', serviceId)
      .single()
    return NextResponse.json({ success: true, data })
  }

  const { data, error } = await supabase
    .from('service_custom_metrics')
    .update(updates)
    .eq('id', metricId)
    .eq('service_id', serviceId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data })
}

// ── DELETE /api/services/[serviceId]/custom-metrics/[metricId] ───────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ serviceId: string; metricId: string }> },
) {
  const { serviceId, metricId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { error } = await supabase
    .from('service_custom_metrics')
    .delete()
    .eq('id', metricId)
    .eq('service_id', serviceId)

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
