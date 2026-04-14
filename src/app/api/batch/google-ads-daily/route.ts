export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateBatchRequest, logBatchAuthFailure } from '@/lib/utils/batch-auth'
import { syncGoogleAdsForServiceConfig } from '@/lib/google-ads/sync-service'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

export async function GET(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('/api/batch/google-ads-daily', request)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runBatch()
}

export async function POST(request: NextRequest) {
  return GET(request)
}

async function runBatch() {
  const admin = createSupabaseAdminClient()
  const startedAt = new Date()

  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'google_ads_daily',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  const errors: Array<{ serviceId: string; error: string }> = []
  let processed = 0

  try {
    const { data: configs, error: cfgErr } = await admin
      .from('google_ads_service_configs')
      .select('service_id, customer_id, collect_keywords, backfill_days, last_synced_at, is_active, time_zone')
      .eq('is_active', true)

    if (cfgErr) throw new Error(cfgErr.message)
    if (!configs || configs.length === 0) {
      await finalize(admin, jobLog?.id, startedAt, processed, errors)
      return NextResponse.json({ success: true, processed: 0, message: 'No active google_ads_service_configs' })
    }

    if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is missing')

    const cfgList = configs as Array<{
      service_id: string
      customer_id: string
      collect_keywords: boolean
      backfill_days: number
      last_synced_at: string | null
      time_zone: string | null
    }>

    console.info('[google-ads-daily] batch start', {
      jobLogId: jobLog?.id,
      activeConfigCount: cfgList.length,
      services: cfgList.map((c) => ({
        service_id: c.service_id,
        customer_id: c.customer_id,
        last_synced_at: c.last_synced_at,
      })),
    })

    for (const cfg of cfgList) {
      const serviceId = cfg.service_id
      console.info('[google-ads-daily] service begin', {
        serviceId,
        customer_id: cfg.customer_id,
      })
      try {
        await syncGoogleAdsForServiceConfig(admin, cfg)
        processed += 1
        console.info('[google-ads-daily] service finished ok', { serviceId })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[google-ads-daily] service error', {
          serviceId,
          msg,
          stack: err instanceof Error ? err.stack : undefined,
        })
        errors.push({ serviceId, error: msg })
      }
    }

    await finalize(admin, jobLog?.id, startedAt, processed, errors)
    return NextResponse.json({ success: true, processed, errors })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[google-ads-daily] fatal', msg)
    await finalize(admin, jobLog?.id, startedAt, processed, [{ serviceId: 'ALL', error: msg }])
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function finalize(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobLogId: string | undefined,
  startedAt: Date,
  processed: number,
  errors: Array<{ serviceId: string; error: string }>
) {
  const status = errors.length === 0 ? 'success' : processed > 0 ? 'partial' : 'failed'
  if (jobLogId) {
    await admin.from('batch_job_logs').update({
      status,
      records_processed: processed,
      records_failed: errors.length,
      error_message: errors.length ? JSON.stringify(errors).slice(0, 4000) : null,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
    }).eq('id', jobLogId)
  }
  if (status !== 'success') {
    await notifyBatchError({
      jobName: 'google_ads_daily',
      processed,
      errorCount: errors.length,
      errors,
      executedAt: startedAt,
    })
  } else {
    await notifyBatchSuccess({
      jobName: 'google_ads_daily',
      processed,
      executedAt: startedAt,
    })
  }
}
