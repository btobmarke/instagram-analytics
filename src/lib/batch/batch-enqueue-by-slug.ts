import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueBatchJob } from '@/lib/batch/batch-queue'
import { enqueueAllWeatherSyncJobs } from '@/lib/batch/queue-weather'

export type EnqueueSummary = {
  enqueued: number
  skipped: number
  failed: number
}

async function pushJob(
  admin: SupabaseClient,
  input: {
    job_name: string
    idempotency_key: string
    correlation_id: string
    trigger_source: 'cron' | 'manual' | 'api' | 'internal'
    project_id?: string | null
    service_id?: string | null
    account_id?: string | null
    payload: Record<string, unknown>
  }
): Promise<{ ok: boolean; skipped: boolean; error?: string }> {
  const res = await enqueueBatchJob(admin, {
    job_name: input.job_name,
    project_id: input.project_id ?? null,
    service_id: input.service_id ?? null,
    account_id: input.account_id ?? null,
    payload: input.payload,
    idempotency_key: input.idempotency_key,
    correlation_id: input.correlation_id,
    trigger_source: input.trigger_source,
  })
  if (res.error) return { ok: false, skipped: false, error: res.error }
  if (res.skipped) return { ok: true, skipped: true }
  return { ok: true, skipped: false }
}

function sum(acc: EnqueueSummary, r: { ok: boolean; skipped: boolean; error?: string }): void {
  if (r.skipped) acc.skipped++
  else if (!r.ok || r.error) acc.failed++
  else acc.enqueued++
}

/** JST 昨日 YYYY-MM-DD */
export function jstYesterdayDate(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  jst.setUTCDate(jst.getUTCDate() - 1)
  return jst.toISOString().slice(0, 10)
}

/** GA4/Clarity 用: UTC 前日 */
export function utcYesterdayDate(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10)
}

/**
 * Cron から slug ごとにキューを満たす。weather-sync は専用ロジック。
 */
export async function enqueueCronBatchJobsForSlug(
  admin: SupabaseClient,
  slug: string,
  trigger: 'cron' | 'manual' | 'api' | 'internal'
): Promise<{ correlation_id: string } & EnqueueSummary> {
  const correlationId = randomUUID()
  const summary: EnqueueSummary = { enqueued: 0, skipped: 0, failed: 0 }
  const dayKey = new Date().toISOString().slice(0, 10)
  const hourKey = new Date().toISOString().slice(0, 13)

  type PushInput = Omit<Parameters<typeof pushJob>[1], 'correlation_id' | 'trigger_source'>
  const track = async (p: PushInput) => {
    const r = await pushJob(admin, { ...p, correlation_id: correlationId, trigger_source: trigger })
    sum(summary, r)
  }

  if (slug === 'weather-sync') {
    const q = await enqueueAllWeatherSyncJobs(
      admin,
      { pastDays: 5, forecastDays: 7 },
      trigger === 'cron' ? 'cron' : 'manual'
    )
    summary.enqueued += q.enqueued
    summary.skipped += q.skipped
    summary.failed += q.failed
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'external-data') {
    const targetDate = jstYesterdayDate()
    const { data: projects, error } = await admin.from('projects').select('id').eq('is_active', true)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const p of projects ?? []) {
      await track({
        job_name: 'external_data_project',
        project_id: p.id,
        payload: { project_id: p.id, target_date: targetDate },
        idempotency_key: `external_data_project:${p.id}:${targetDate}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'project-metrics-aggregate') {
    const targetDate = jstYesterdayDate()
    const { data: projects, error } = await admin.from('projects').select('id').eq('is_active', true)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const p of projects ?? []) {
      await track({
        job_name: 'project_metrics_aggregate_project',
        project_id: p.id,
        payload: { project_id: p.id, target_date: targetDate },
        idempotency_key: `project_metrics_aggregate_project:${p.id}:${targetDate}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'google-ads-daily') {
    const { data: configs, error } = await admin
      .from('google_ads_service_configs')
      .select('service_id')
      .eq('is_active', true)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const c of configs ?? []) {
      await track({
        job_name: 'google_ads_daily_service',
        service_id: c.service_id,
        payload: { service_id: c.service_id },
        idempotency_key: `google_ads_daily_service:${c.service_id}:${dayKey}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'ga4-collector') {
    const targetDate = utcYesterdayDate()
    const { data: rows, error } = await admin
      .from('service_integrations')
      .select('service_id')
      .eq('integration_type', 'GA4')
      .eq('status', 'active')
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const r of rows ?? []) {
      await track({
        job_name: 'ga4_collector_service',
        service_id: r.service_id,
        payload: { service_id: r.service_id, target_date: targetDate },
        idempotency_key: `ga4_collector_service:${r.service_id}:${targetDate}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'clarity-collector') {
    const targetDate = utcYesterdayDate()
    const { data: rows, error } = await admin
      .from('service_integrations')
      .select('service_id')
      .eq('integration_type', 'CLARITY')
      .eq('status', 'active')
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const r of rows ?? []) {
      await track({
        job_name: 'clarity_collector_service',
        service_id: r.service_id,
        payload: { service_id: r.service_id, target_date: targetDate },
        idempotency_key: `clarity_collector_service:${r.service_id}:${targetDate}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'media-collector' || slug === 'insight-collector' || slug === 'kpi-calc') {
    const { data: accounts, error } = await admin
      .from('ig_accounts')
      .select('id, service_id')
      .eq('status', 'active')
      .not('service_id', 'is', null)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    const jobName =
      slug === 'media-collector'
        ? 'media_collector_account'
        : slug === 'insight-collector'
          ? 'insight_collector_account'
          : 'kpi_calc_account'
    const keyPrefix =
      slug === 'media-collector' ? 'media_collector' : slug === 'insight-collector' ? 'insight_collector' : 'kpi_calc'
    for (const a of accounts ?? []) {
      await track({
        job_name: jobName,
        service_id: a.service_id,
        account_id: a.id,
        payload: { account_id: a.id },
        idempotency_key: `${keyPrefix}:${a.id}:${hourKey}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'story-media-collector' || slug === 'story-insight-collector') {
    const jobName =
      slug === 'story-media-collector' ? 'story_media_collector_account' : 'story_insight_collector_account'
    const keyPrefix = slug === 'story-media-collector' ? 'story_media' : 'story_insight'
    const { data: accounts, error } = await admin
      .from('ig_accounts')
      .select('id, service_id')
      .eq('status', 'active')
      .not('service_id', 'is', null)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const a of accounts ?? []) {
      await track({
        job_name: jobName,
        service_id: a.service_id,
        account_id: a.id,
        payload: { account_id: a.id },
        idempotency_key: `${keyPrefix}:${a.id}:${hourKey}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'lp-session-cleanup') {
    const { data: sites, error } = await admin.from('lp_sites').select('id, service_id').eq('is_active', true)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const s of sites ?? []) {
      await track({
        job_name: 'lp_session_cleanup_site',
        service_id: s.service_id,
        payload: { lp_site_id: s.id },
        idempotency_key: `lp_session_cleanup_site:${s.id}:${hourKey}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'lp-aggregate') {
    const { data: sites, error } = await admin.from('lp_sites').select('id, service_id').eq('is_active', true)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const s of sites ?? []) {
      await track({
        job_name: 'lp_aggregate_site',
        service_id: s.service_id,
        payload: { lp_site_id: s.id },
        idempotency_key: `lp_aggregate_site:${s.id}:${dayKey}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'line-oam-daily') {
    const { data: configs, error } = await admin
      .from('line_oam_service_configs')
      .select('service_id')
      .eq('is_active', true)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const row of configs ?? []) {
      await track({
        job_name: 'line_oam_daily_service',
        service_id: row.service_id,
        payload: { service_id: row.service_id },
        idempotency_key: `line_oam_daily_service:${row.service_id}:${dayKey}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'gbp-daily') {
    const { data: sites, error } = await admin
      .from('gbp_sites')
      .select('id, service_id')
      .eq('is_active', true)
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    for (const s of sites ?? []) {
      await track({
        job_name: 'gbp_daily_site',
        service_id: s.service_id,
        payload: { site_id: s.id },
        idempotency_key: `gbp_daily_site:${s.id}:${dayKey}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'ai-analysis' || slug === 'instagram-velocity-retro') {
    const { data: accounts, error } = await admin
      .from('ig_accounts')
      .select('id, service_id')
      .eq('status', 'active')
    if (error) {
      summary.failed++
      return { correlation_id: correlationId, ...summary }
    }
    const jobName =
      slug === 'ai-analysis' ? 'weekly_ai_analysis_account' : 'instagram_velocity_retro_account'
    const keyPrefix = slug === 'ai-analysis' ? 'weekly_ai_analysis' : 'instagram_velocity_retro'
    const weekId = weekStartUtcMondayId()
    for (const a of accounts ?? []) {
      await track({
        job_name: jobName,
        service_id: a.service_id,
        account_id: a.id,
        payload: { account_id: a.id },
        idempotency_key: `${keyPrefix}:${a.id}:${weekId}`,
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  throw new Error(`enqueueCronBatchJobsForSlug: unsupported slug "${slug}"`)
}

function weekStartUtcMondayId(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  x.setUTCDate(x.getUTCDate() + diff)
  return x.toISOString().slice(0, 10)
}
