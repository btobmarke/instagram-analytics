/**
 * POST /api/projects/[projectId]/unified-summary/query
 *
 * 横断サマリーテンプレ用: テンプレに含まれるサービスごとに、必要な fieldRef だけ
 * fetchMetricsByRefs で取得して返す（unified-summary GET の固定カタログより広い）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildPeriods, fetchMetricsByRefs } from '@/lib/summary/fetch-metrics'
import type { TimeUnit } from '@/lib/summary/fetch-metrics'

const ServiceBlockSchema = z.object({
  serviceId: z.string().min(1),
  fieldRefs: z.array(z.string().min(1)).min(1).max(200),
})

const BodySchema = z.object({
  timeUnit: z.enum(['hour', 'day', 'week', 'month', 'custom_range']),
  count: z.number().int().min(1).max(90).optional().default(14),
  rangeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  services: z.array(ServiceBlockSchema).min(1).max(50),
})

type MetricValues = Record<string, number | null>

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).single()
  if (!project) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'プロジェクトが見つかりません' } },
      { status: 404 },
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

  const { timeUnit, count, rangeStart, rangeEnd, services: svcBlocks } = parsed.data
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

  const serviceIds = [...new Set(svcBlocks.map((s) => s.serviceId))]
  const { data: svcRows, error: svcErr } = await supabase
    .from('services')
    .select('id, service_name, service_type, project_id')
    .eq('project_id', projectId)
    .in('id', serviceIds)
    .is('deleted_at', null)

  if (svcErr) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: svcErr.message } },
      { status: 500 },
    )
  }

  const allowed = new Map((svcRows ?? []).map((r) => [r.id as string, r]))
  for (const sid of serviceIds) {
    if (!allowed.has(sid)) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: `無効な serviceId: ${sid}` } },
        { status: 400 },
      )
    }
  }

  const mergedByService = new Map<string, Set<string>>()
  for (const b of svcBlocks) {
    let set = mergedByService.get(b.serviceId)
    if (!set) {
      set = new Set()
      mergedByService.set(b.serviceId, set)
    }
    for (const r of b.fieldRefs) set.add(r)
  }

  const fetchResults = await Promise.all(
    [...mergedByService.entries()].map(async ([serviceId, refSet]) => {
      const fieldRefs = [...refSet]
      try {
        const raw = await fetchMetricsByRefs(supabase, serviceId, fieldRefs, periods)
        return { serviceId, raw: raw as Record<string, Record<string, number | null>> }
      } catch (e) {
        console.error('[unified-summary/query] fetch failed', { serviceId, e })
        return { serviceId, raw: {} as Record<string, Record<string, number | null>> }
      }
    }),
  )

  const rawByService = new Map(fetchResults.map((r) => [r.serviceId, r.raw]))

  type OutMetric = { label: string; category: string; values: MetricValues }
  const outServices = serviceIds.map((sid) => {
    const row = allowed.get(sid)!
    const raw = rawByService.get(sid) ?? {}
    const metrics: Record<string, OutMetric> = {}
    for (const ref of mergedByService.get(sid) ?? new Set()) {
      const values = raw[ref] ?? Object.fromEntries(periods.map((p) => [p.label, null]))
      metrics[ref] = {
        label: ref,
        category: '',
        values,
      }
    }
    return {
      id: row.id as string,
      name: row.service_name as string,
      serviceType: row.service_type as string,
      metrics,
    }
  })

  return NextResponse.json({
    success: true,
    data: {
      periods: periods.map((p) => p.label),
      services: outServices,
    },
  })
}
