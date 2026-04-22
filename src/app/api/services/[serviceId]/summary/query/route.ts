/**
 * POST /api/services/[serviceId]/summary/query
 *
 * サマリービュー用: メトリクス取得 + 任意の内訳（breakdown）をまとめて返す。
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  buildPeriods,
  fetchMetricsByRefs,
  fetchLineOamFriendsAttrBreakdownsByRow,
  fetchIgAccountInsightBreakdownsByRow,
} from '@/lib/summary/fetch-metrics'
import type { TimeUnit } from '@/lib/summary/fetch-metrics'

const LineBreakdownSliceSchema = z.object({
  label: z.string().min(1).max(120),
  gender: z.string().max(50).optional().nullable(),
  age: z.string().max(80).optional().nullable(),
})

const IgBreakdownSliceSchema = z.object({
  label: z.string().min(1).max(120),
  dimension_code: z.string().min(1).max(80),
  dimension_value: z.string().min(1).max(120),
})

const BreakdownRowSchema = z.discriminatedUnion('table', [
  z.object({
    rowId: z.string().min(1).max(200),
    table: z.literal('line_oam_friends_attr'),
    slices: z.array(LineBreakdownSliceSchema).min(1).max(80),
  }),
  z.object({
    rowId: z.string().min(1).max(200),
    table: z.literal('ig_account_insight_fact'),
    metricCode: z.string().min(1).max(120),
    period: z.literal('lifetime'),
    slices: z.array(IgBreakdownSliceSchema).min(1).max(80),
  }),
])

const BodySchema = z.object({
  timeUnit: z.enum(['hour', 'day', 'week', 'month', 'custom_range']),
  count: z.number().int().min(1).max(24).optional().default(8),
  rangeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  fieldRefs: z.array(z.string().min(1)).max(200),
  breakdowns: z.array(BreakdownRowSchema).max(30).optional(),
})

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
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      { status: 400 },
    )
  }

  const { timeUnit, count, rangeStart, rangeEnd, fieldRefs, breakdowns } = parsed.data
  const periodsOrError = buildPeriods(
    timeUnit as TimeUnit,
    count,
    rangeStart ?? undefined,
    rangeEnd ?? undefined,
  )
  if ('error' in periodsOrError) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: periodsOrError.error } },
      { status: 400 },
    )
  }

  const periods = periodsOrError
  const uniqueRefs = [...new Set(fieldRefs)]

  const lineBreakdownConfigs = (breakdowns ?? [])
    .filter((b): b is Extract<z.infer<typeof BreakdownRowSchema>, { table: 'line_oam_friends_attr' }> => b.table === 'line_oam_friends_attr')
    .map((b) => ({ rowId: b.rowId, slices: b.slices }))

  const igBreakdownConfigs = (breakdowns ?? [])
    .filter((b): b is Extract<z.infer<typeof BreakdownRowSchema>, { table: 'ig_account_insight_fact' }> => b.table === 'ig_account_insight_fact')
    .map((b) => ({ rowId: b.rowId, metricCode: b.metricCode, slices: b.slices }))

  const [metrics, lineBreakdownByRow, igBreakdownByRow] = await Promise.all([
    uniqueRefs.length > 0
      ? fetchMetricsByRefs(supabase, serviceId, uniqueRefs, periods)
      : Promise.resolve({} as Record<string, Record<string, number | null>>),
    lineBreakdownConfigs.length > 0
      ? fetchLineOamFriendsAttrBreakdownsByRow(supabase, serviceId, lineBreakdownConfigs, periods)
      : Promise.resolve({} as Record<string, Record<string, Array<{ label: string; value: number | null }>>>),
    igBreakdownConfigs.length > 0
      ? fetchIgAccountInsightBreakdownsByRow(supabase, serviceId, igBreakdownConfigs, periods)
      : Promise.resolve({} as Record<string, Record<string, Array<{ label: string; value: number | null }>>>),
  ])

  const breakdownByRow = { ...lineBreakdownByRow, ...igBreakdownByRow }

  return NextResponse.json({
    success: true,
    data: {
      metrics,
      breakdownByRow,
    },
  })
}
