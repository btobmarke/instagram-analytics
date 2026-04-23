import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueBatchJob } from '@/lib/batch/batch-queue'
import { loadActiveProjectsWithCoordinates } from '@/lib/batch/jobs/weather-sync-project'
import { enqueueAllWeatherSyncJobs } from '@/lib/batch/queue-weather'

export type EnqueueSummary = {
  enqueued: number
  skipped: number
  failed: number
}

async function pushProxy(
  admin: SupabaseClient,
  input: {
    idempotency_key: string
    correlation_id: string
    trigger_source: 'cron' | 'manual' | 'api' | 'internal'
    project_id: string | null
    service_id: string | null
    account_id: string | null
    path: string
    method?: 'GET' | 'POST'
    query?: Record<string, string | undefined>
    body?: Record<string, unknown>
  }
): Promise<{ ok: boolean; skipped: boolean; error?: string }> {
  const res = await enqueueBatchJob(admin, {
    job_name: 'batch_proxy',
    project_id: input.project_id,
    service_id: input.service_id,
    account_id: input.account_id,
    payload: {
      path: input.path,
      method: input.method ?? 'POST',
      query: input.query,
      body: input.body,
    },
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

/** JST 昨日 YYYY-MM-DD（external-data / project-metrics と同様） */
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

  const track = async (p: Parameters<typeof pushProxy>[1]) => {
    const r = await pushProxy(admin, { ...p, correlation_id: correlationId, trigger_source: trigger })
    sum(summary, r)
  }

  if (slug === 'weather-sync') {
    const { projects } = await loadActiveProjectsWithCoordinates(admin)
    const q = await enqueueAllWeatherSyncJobs(
      admin,
      { pastDays: 5, forecastDays: 7 },
      trigger === 'cron' ? 'cron' : 'manual'
    )
    summary.enqueued += q.enqueued
    summary.skipped += q.skipped
    summary.failed += q.failed
    void projects
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
        project_id: p.id,
        service_id: null,
        account_id: null,
        idempotency_key: `batch_proxy:external_data:${p.id}:${targetDate}`,
        path: '/api/batch/external-data',
        method: 'GET',
        query: { date: targetDate, project: p.id },
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
        project_id: p.id,
        service_id: null,
        account_id: null,
        idempotency_key: `batch_proxy:project_metrics_aggregate:${p.id}:${targetDate}`,
        path: '/api/batch/project-metrics-aggregate',
        method: 'GET',
        query: { date: targetDate, project: p.id },
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
        project_id: null,
        service_id: c.service_id,
        account_id: null,
        idempotency_key: `batch_proxy:google_ads_daily:${c.service_id}:${dayKey}`,
        path: '/api/batch/google-ads-daily',
        method: 'POST',
        body: { service_id: c.service_id },
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
        project_id: null,
        service_id: r.service_id,
        account_id: null,
        idempotency_key: `batch_proxy:ga4_collector:${r.service_id}:${targetDate}`,
        path: '/api/batch/ga4-collector',
        method: 'POST',
        body: { date: targetDate, service_id: r.service_id },
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
        project_id: null,
        service_id: r.service_id,
        account_id: null,
        idempotency_key: `batch_proxy:clarity_collector:${r.service_id}:${targetDate}`,
        path: '/api/batch/clarity-collector',
        method: 'POST',
        body: { date: targetDate, service_id: r.service_id },
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
    const path =
      slug === 'media-collector'
        ? '/api/batch/media-collector'
        : slug === 'insight-collector'
          ? '/api/batch/insight-collector'
          : '/api/batch/kpi-calc'
    const jobKey =
      slug === 'media-collector'
        ? 'media_collector'
        : slug === 'insight-collector'
          ? 'insight_collector'
          : 'kpi_calc'
    for (const a of accounts ?? []) {
      await track({
        project_id: null,
        service_id: a.service_id,
        account_id: a.id,
        idempotency_key: `batch_proxy:${jobKey}:${a.id}:${hourKey}`,
        path,
        method: 'POST',
        body: { account_id: a.id },
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  if (slug === 'story-media-collector' || slug === 'story-insight-collector') {
    const path =
      slug === 'story-media-collector' ? '/api/batch/story-media-collector' : '/api/batch/story-insight-collector'
    const jobKey = slug === 'story-media-collector' ? 'story_media_collector' : 'story_insight_collector'
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
        project_id: null,
        service_id: a.service_id,
        account_id: a.id,
        idempotency_key: `batch_proxy:${jobKey}:${a.id}:${hourKey}`,
        path,
        method: 'POST',
        body: { account_id: a.id },
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
        project_id: null,
        service_id: s.service_id,
        account_id: null,
        idempotency_key: `batch_proxy:lp_session_cleanup:${s.id}:${hourKey}`,
        path: '/api/batch/lp-session-cleanup',
        method: 'GET',
        query: { lp_site_id: s.id },
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
        project_id: null,
        service_id: s.service_id,
        account_id: null,
        idempotency_key: `batch_proxy:lp_aggregate:${s.id}:${dayKey}`,
        path: '/api/batch/lp-aggregate',
        method: 'GET',
        query: { lp_site_id: s.id },
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
        project_id: null,
        service_id: row.service_id,
        account_id: null,
        idempotency_key: `batch_proxy:line_oam_daily:${row.service_id}:${dayKey}`,
        path: '/api/batch/line-oam-daily',
        method: 'POST',
        body: { service_id: row.service_id },
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
        project_id: null,
        service_id: s.service_id,
        account_id: null,
        idempotency_key: `batch_proxy:gbp_daily:${s.id}:${dayKey}`,
        path: '/api/batch/gbp-daily',
        method: 'GET',
        query: { site_id: s.id },
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
    const jobKey = slug === 'ai-analysis' ? 'weekly_ai_analysis' : 'instagram_velocity_retro'
    const weekId = weekStartUtcMondayId()
    for (const a of accounts ?? []) {
      await track({
        project_id: null,
        service_id: a.service_id,
        account_id: a.id,
        idempotency_key: `batch_proxy:${jobKey}:${a.id}:${weekId}`,
        path: `/api/batch/${slug}`,
        method: 'POST',
        body: { account_id: a.id },
      })
    }
    return { correlation_id: correlationId, ...summary }
  }

  await track({
    project_id: null,
    service_id: null,
    account_id: null,
    idempotency_key: `batch_proxy:${slug.replace(/-/g, '_')}:${hourKey}`,
    path: `/api/batch/${slug}`,
    method: 'POST',
    body: {},
  })
  return { correlation_id: correlationId, ...summary }
}

/** 週次ジョブの冪等キー用: UTC 月曜始まりの週 YYYY-MM-DD */
function weekStartUtcMondayId(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay() // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day
  x.setUTCDate(x.getUTCDate() + diff)
  return x.toISOString().slice(0, 10)
}
