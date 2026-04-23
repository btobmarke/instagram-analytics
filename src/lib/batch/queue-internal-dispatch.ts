import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { runExternalDataForProject } from '@/lib/batch/queue-job-handlers/external-data-project'
import { runGoogleAdsForService } from '@/lib/batch/queue-job-handlers/google-ads-service'
import { runProjectMetricsAggregateForProject } from '@/lib/batch/project-metrics-aggregate-one-project'
import { syncGa4OneService, type Ga4IntegrationRow } from '@/lib/batch/ga4-sync-one-service'
import { syncClarityOneService, type ClarityIntegrationRow } from '@/lib/batch/clarity-sync-one-service'
import { runMediaCollectorForAccount, type MediaCollectorAccountRow } from '@/lib/batch/media-collector-one-account'
import { runKpiCalcForAccount } from '@/lib/batch/kpi-calc-one-account'
import { getBatchAuthHeader } from '@/lib/batch/internal-batch-fetch'
function bearerRequest(url: string, body: Record<string, unknown>): NextRequest {
  const auth = getBatchAuthHeader()
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  })
}

function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (explicit) return explicit
  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`
  return 'http://localhost:3000'
}

/**
 * キューワーカーからバッチ処理を **HTTP なし**で実行（可能なものは lib、巨大ルートは合成 Request で Route POST）。
 */
export async function dispatchQueueJobInProcess(
  admin: SupabaseClient,
  jobName: string,
  payload: Record<string, unknown>
): Promise<void> {
  const base = getBaseUrl()

  switch (jobName) {
    case 'external_data_project':
      await runExternalDataForProject(admin, {
        project_id: payload.project_id as string,
        target_date: payload.target_date as string,
      })
      return

    case 'project_metrics_aggregate_project':
      await runProjectMetricsAggregateForProject(
        admin,
        payload.project_id as string,
        payload.target_date as string
      )
      return

    case 'google_ads_daily_service':
      await runGoogleAdsForService(admin, { service_id: payload.service_id as string })
      return

    case 'ga4_collector_service': {
      const { data: integ, error } = await admin
        .from('service_integrations')
        .select('id, service_id, external_project_id, encrypted_credential, status')
        .eq('integration_type', 'GA4')
        .eq('status', 'active')
        .eq('service_id', payload.service_id as string)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!integ) throw new Error('GA4 integration not found')
      const res = await syncGa4OneService(admin, integ as Ga4IntegrationRow, payload.target_date as string)
      if (res.status === 'error') throw new Error(res.error ?? 'ga4 sync failed')
      return
    }

    case 'clarity_collector_service': {
      const { data: integ, error } = await admin
        .from('service_integrations')
        .select('id, service_id, external_project_id, encrypted_credential, status')
        .eq('integration_type', 'CLARITY')
        .eq('status', 'active')
        .eq('service_id', payload.service_id as string)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!integ) throw new Error('Clarity integration not found')
      const res = await syncClarityOneService(admin, integ as ClarityIntegrationRow, payload.target_date as string)
      if (res.status === 'error') throw new Error(res.error ?? 'clarity sync failed')
      return
    }

    case 'media_collector_account': {
      const { data: account, error } = await admin
        .from('ig_accounts')
        .select('id, platform_account_id, api_base_url, api_version, service_id')
        .eq('id', payload.account_id as string)
        .eq('status', 'active')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!account?.service_id) throw new Error('account not found')
      await runMediaCollectorForAccount(admin, account as MediaCollectorAccountRow)
      return
    }

    case 'kpi_calc_account': {
      const { data: masters } = await admin.from('kpi_master').select('*').eq('is_active', true)
      await runKpiCalcForAccount(admin, payload.account_id as string, (masters ?? []) as never[])
      return
    }

    case 'insight_collector_account': {
      const { POST } = await import('@/app/api/batch/insight-collector/route')
      const res = await POST(bearerRequest(`${base}/api/batch/insight-collector`, { account_id: payload.account_id }))
      if (!res.ok) throw new Error(`insight-collector ${res.status}`)
      return
    }

    case 'story_media_collector_account': {
      const { POST } = await import('@/app/api/batch/story-media-collector/route')
      const res = await POST(bearerRequest(`${base}/api/batch/story-media-collector`, { account_id: payload.account_id }))
      if (!res.ok) throw new Error(`story-media-collector ${res.status}`)
      return
    }

    case 'story_insight_collector_account': {
      const { POST } = await import('@/app/api/batch/story-insight-collector/route')
      const res = await POST(bearerRequest(`${base}/api/batch/story-insight-collector`, { account_id: payload.account_id }))
      if (!res.ok) throw new Error(`story-insight-collector ${res.status}`)
      return
    }

    case 'lp_session_cleanup_site': {
      const { POST } = await import('@/app/api/batch/lp-session-cleanup/route')
      const url = new URL(`${base}/api/batch/lp-session-cleanup`)
      url.searchParams.set('lp_site_id', payload.lp_site_id as string)
      const auth = getBatchAuthHeader()
      const res = await POST(new NextRequest(url.toString(), { headers: auth ? { Authorization: auth } : {} }))
      if (!res.ok) throw new Error(`lp-session-cleanup ${res.status}`)
      return
    }

    case 'lp_aggregate_site': {
      const { POST } = await import('@/app/api/batch/lp-aggregate/route')
      const url = new URL(`${base}/api/batch/lp-aggregate`)
      url.searchParams.set('lp_site_id', payload.lp_site_id as string)
      const auth = getBatchAuthHeader()
      const res = await POST(new NextRequest(url.toString(), { headers: auth ? { Authorization: auth } : {} }))
      if (!res.ok) throw new Error(`lp-aggregate ${res.status}`)
      return
    }

    case 'line_oam_daily_service': {
      const { POST } = await import('@/app/api/batch/line-oam-daily/route')
      const res = await POST(
        bearerRequest(`${base}/api/batch/line-oam-daily`, { service_id: payload.service_id })
      )
      if (!res.ok) throw new Error(`line-oam-daily ${res.status}`)
      return
    }

    case 'gbp_daily_site': {
      const { POST } = await import('@/app/api/batch/gbp-daily/route')
      const url = new URL(`${base}/api/batch/gbp-daily`)
      url.searchParams.set('site_id', payload.site_id as string)
      const auth = getBatchAuthHeader()
      const res = await POST(new NextRequest(url.toString(), { headers: auth ? { Authorization: auth } : {} }))
      if (!res.ok) throw new Error(`gbp-daily ${res.status}`)
      return
    }

    case 'weekly_ai_analysis_account': {
      const { runAiAnalysisBatch } = await import('@/app/api/batch/ai-analysis/route')
      const res = await runAiAnalysisBatch(payload.account_id as string | undefined)
      if (!res.ok) throw new Error(`ai-analysis ${res.status}`)
      return
    }

    case 'instagram_velocity_retro_account': {
      const { runInstagramVelocityRetroBatch } = await import('@/app/api/batch/instagram-velocity-retro/route')
      const res = await runInstagramVelocityRetroBatch(payload.account_id as string | undefined)
      if (!res.ok) throw new Error(`instagram-velocity-retro ${res.status}`)
      return
    }

    default:
      throw new Error(`Unknown queue job_name: ${jobName}`)
  }
}
