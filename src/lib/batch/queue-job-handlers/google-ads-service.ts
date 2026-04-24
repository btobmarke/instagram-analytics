import type { SupabaseClient } from '@supabase/supabase-js'
import { syncGoogleAdsForServiceConfig } from '@/lib/google-ads/sync-service'

export type GoogleAdsServicePayload = { service_id: string }

export async function runGoogleAdsForService(
  admin: SupabaseClient,
  payload: GoogleAdsServicePayload
): Promise<void> {
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is missing')
  }

  const { data: cfg, error } = await admin
    .from('google_ads_service_configs')
    .select('service_id, customer_id, collect_keywords, backfill_days, last_synced_at, is_active, time_zone')
    .eq('is_active', true)
    .eq('service_id', payload.service_id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!cfg) throw new Error('No active google_ads_service_configs for service_id')

  await syncGoogleAdsForServiceConfig(
    admin,
    cfg as {
      service_id: string
      customer_id: string
      collect_keywords: boolean
      backfill_days: number
      last_synced_at: string | null
      time_zone: string | null
    }
  )
}
