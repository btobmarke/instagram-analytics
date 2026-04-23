export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { enqueueBatchJob } from '@/lib/batch/batch-queue'
import { enqueueAllWeatherSyncJobs, isBatchQueueDisabled } from '@/lib/batch/queue-weather'
import { randomUUID } from 'crypto'
import { DEFAULT_WEATHER_OPTIONS } from '@/lib/batch/jobs/weather-sync-project'

const BodySchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('project'),
    project_id: z.string().uuid(),
    past_days: z.number().int().min(0).max(92).optional(),
    forecast_days: z.number().int().min(1).max(16).optional(),
  }),
  z.object({
    scope: z.literal('all_active_projects'),
    past_days: z.number().int().min(0).max(92).optional(),
    forecast_days: z.number().int().min(1).max(16).optional(),
  }),
])

/**
 * POST /api/batch/weather-sync/enqueue
 * - scope=project: ログインユーザーが当該プロジェクトにアクセス可なら 1 件キュー投入
 * - scope=all_active_projects: CRON_SECRET / BATCH_SECRET のみ
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isBatchQueueDisabled()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Queue is disabled (BATCH_QUEUE_DISABLED=true). Use /api/batch/weather-sync with batch auth.',
      },
      { status: 503 }
    )
  }

  const json = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const admin = createSupabaseAdminClient()
  const pastDays = parsed.data.past_days ?? DEFAULT_WEATHER_OPTIONS.pastDays
  const forecastDays = parsed.data.forecast_days ?? DEFAULT_WEATHER_OPTIONS.forecastDays
  const options = { pastDays, forecastDays }

  if (parsed.data.scope === 'all_active_projects') {
    if (!validateBatchRequest(request)) {
      logBatchAuthFailure('weather-sync/enqueue', request)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    try {
      const q = await enqueueAllWeatherSyncJobs(admin, options, 'manual')
      return NextResponse.json({ success: true, ...q, past_days: pastDays, forecast_days: forecastDays })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data: project, error: pErr } = await supabase
    .from('projects')
    .select('id')
    .eq('id', parsed.data.project_id)
    .eq('is_active', true)
    .maybeSingle()

  if (pErr || !project) {
    return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 })
  }

  const correlationId = randomUUID()
  const dayKey = new Date().toISOString().slice(0, 10)
  const idempotencyKey = `weather_sync:${parsed.data.project_id}:${dayKey}:manual:${user.id}`

  const res = await enqueueBatchJob(admin, {
    job_name: 'weather_sync',
    project_id: parsed.data.project_id,
    payload: { past_days: pastDays, forecast_days: forecastDays },
    idempotency_key: idempotencyKey,
    correlation_id: correlationId,
    trigger_source: 'manual',
  })

  if (res.error) {
    return NextResponse.json({ success: false, error: res.error }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    skipped: res.skipped,
    queue_job_id: res.id,
    correlation_id: correlationId,
    project_id: parsed.data.project_id,
    past_days: pastDays,
    forecast_days: forecastDays,
  })
}
