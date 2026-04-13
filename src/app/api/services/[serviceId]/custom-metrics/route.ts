import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ── FormulaNode バリデーション ─────────────────────────────────────────────────

const FormulaStepSchema = z.object({
  operator:  z.enum(['+', '-', '*', '/']),
  operandId: z.string().min(1),
})

const FormulaNodeSchema = z.object({
  baseOperandId:  z.string().min(1),
  steps:          z.array(FormulaStepSchema),
  thresholdMode:  z.enum(['none', 'gte', 'lte']).optional(),
  thresholdValue: z.number().nullable().optional(),
})

const CreateSchema = z.object({
  name:    z.string().min(1).max(100),
  formula: FormulaNodeSchema,
})

// ── GET /api/services/[serviceId]/custom-metrics ──────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { data, error } = await supabase
    .from('service_custom_metrics')
    .select('*')
    .eq('service_id', serviceId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: data ?? [] })
}

// ── POST /api/services/[serviceId]/custom-metrics ─────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('service_custom_metrics')
    .insert({ service_id: serviceId, name: parsed.data.name, formula: parsed.data.formula })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}
