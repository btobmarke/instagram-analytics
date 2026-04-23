export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { enqueueCronBatchJobsForSlug } from '@/lib/batch/batch-enqueue-by-slug'
import { z } from 'zod'

const BodySchema = z.object({
  /** vercel cron-groups と同じスラッグ（例: ga4-collector, weather-sync） */
  job_slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'job_slug は小文字・数字・ハイフンのみ'),
})

/**
 * POST /api/batch/enqueue
 * Bearer CRON_SECRET / BATCH_SECRET のみ。
 * 指定スラッグについて `enqueueCronBatchJobsForSlug` と同じ分解投入（手動トリガ用）。
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('batch/enqueue', request)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  try {
    const result = await enqueueCronBatchJobsForSlug(admin, parsed.data.job_slug, 'manual')
    return NextResponse.json({
      ok: result.failed === 0,
      job_slug: parsed.data.job_slug,
      ...result,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[batch/enqueue]', msg, e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
