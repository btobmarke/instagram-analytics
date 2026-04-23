import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getGoogleAdsAccessToken } from '@/lib/google-ads/auth'
import { searchStream } from '@/lib/google-ads/api'
import { resolveGoogleAdsSyncDateRange } from '@/lib/google-ads/reporting-dates'
import { finiteNumberOrZero } from '@/lib/batch/numeric-coerce'

export type GoogleAdsServiceSyncConfig = {
  service_id: string
  customer_id: string
  collect_keywords: boolean
  backfill_days: number
  last_synced_at: string | null
  /** 昨日の境界。未設定時は Asia/Tokyo */
  time_zone?: string | null
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

async function upsertWithLog(
  admin: AdminClient,
  meta: { serviceId: string; phase: string },
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  if (rows.length === 0) {
    console.info('[google-ads sync] upsert skip (0 rows)', { ...meta, table })
    return
  }
  const { error } = await admin.from(table).upsert(rows, { onConflict })
  if (error) {
    console.error('[google-ads sync] upsert FAILED', {
      ...meta,
      table,
      rowCount: rows.length,
      message: error.message,
      code: (error as { code?: string }).code,
      details: (error as { details?: string }).details,
      hint: (error as { hint?: string }).hint,
      sampleRow: rows[0],
    })
    throw new Error(`${meta.phase} ${table}: ${error.message}`)
  }
  console.info('[google-ads sync] upsert ok', { ...meta, table, rowCount: rows.length })
}

async function touchLastSyncedAt(admin: AdminClient, serviceId: string): Promise<void> {
  const { error: cfgUpdErr } = await admin.from('google_ads_service_configs')
    .update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('service_id', serviceId)
  if (cfgUpdErr) {
    console.error('[google-ads sync] last_synced_at update FAILED', { serviceId, error: cfgUpdErr })
    throw new Error(`google_ads_service_configs update: ${cfgUpdErr.message}`)
  }
}

function toMicros(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1_000_000)
}

/** v23 以降は start_date_time（"yyyy-MM-dd HH:mm:ss"）。DB の DATE 用に日付部分だけ抜く */
function datePartFromAdsDateTime(value: unknown): string | null {
  if (value == null || value === '') return null
  const s = String(value).trim()
  const d = s.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

/**
 * 1 サービス分の Google 広告日次同期（キャンペーン / 広告グループ / 任意でキーワード）。
 * - 通常: アカウント TZ の「昨日」までを 1 日または欠損分まとめて取得。
 * - 初回: 昨日を終端に backfill_days 日。
 * 成功時（API 不要の noop 含む）は last_synced_at を更新する。
 */
export async function syncGoogleAdsForServiceConfig(
  admin: AdminClient,
  cfg: GoogleAdsServiceSyncConfig
): Promise<void> {
  const serviceId = cfg.service_id

  const { start, end, mode } = resolveGoogleAdsSyncDateRange({
    timeZone: cfg.time_zone,
    lastSyncedAt: cfg.last_synced_at,
    backfillDays: cfg.backfill_days ?? 30,
  })

  console.info('[google-ads sync] start', {
    serviceId,
    customerId: cfg.customer_id,
    dateRange: { start, end },
    dateMode: mode,
    timeZone: cfg.time_zone?.trim() || 'Asia/Tokyo(default)',
    lastSyncedAt: cfg.last_synced_at,
    collectKeywords: cfg.collect_keywords,
  })

  if (mode === 'noop') {
    await touchLastSyncedAt(admin, serviceId)
    console.info('[google-ads sync] noop — 取得対象日なし（いまの暦では既に昨日まで反映済み）', { serviceId })
    return
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!developerToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is missing')

  const { data: svc, error: svcErr } = await admin
    .from('services')
    .select('id, project_id, projects!inner(client_id)')
    .eq('id', serviceId)
    .single()
  if (svcErr || !svc) throw new Error(`service lookup failed: ${svcErr?.message ?? 'not found'}`)
  const clientId = (svc as unknown as { projects: { client_id: string } }).projects.client_id

  const { data: cred, error: credErr } = await admin
    .from('client_google_ads_credentials')
    .select('manager_customer_id, auth_status')
    .eq('client_id', clientId)
    .single()
  if (credErr || !cred) throw new Error('credentials not found')
  if ((cred as { auth_status: string }).auth_status !== 'active') throw new Error('credentials not active')
  const managerCustomerId = (cred as { manager_customer_id: string }).manager_customer_id

  const accessToken = await getGoogleAdsAccessToken(clientId)

  const campaignQuery = `
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign_budget.amount_micros,
  campaign.bidding_strategy_type,
  campaign.start_date_time,
  campaign.end_date_time,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.ctr,
  metrics.average_cpc,
  segments.date
FROM campaign
WHERE segments.date BETWEEN '${start}' AND '${end}'
  AND campaign.status != 'REMOVED'
ORDER BY segments.date DESC
`.trim()

  const campaignRows = await searchStream({
    accessToken,
    developerToken,
    managerCustomerId,
    customerAccountId: cfg.customer_id,
    query: campaignQuery,
    debugLabel: 'campaign',
  })

  const campaignMaster = new Map<string, Record<string, unknown>>()
  const campaignDaily: Array<Record<string, unknown>> = []
  let campaignSkipNoId = 0
  let campaignSkipNoDate = 0
  for (const r of campaignRows) {
    const campaign = r.campaign as Record<string, unknown> | undefined
    const budget = r.campaignBudget as Record<string, unknown> | undefined
    const metrics = r.metrics as Record<string, unknown> | undefined
    const segments = r.segments as Record<string, unknown> | undefined
    const campaignId = String(campaign?.id ?? '')
    const date = String(segments?.date ?? '')
    if (!campaignId) {
      campaignSkipNoId += 1
      continue
    }
    if (!date) {
      campaignSkipNoDate += 1
      continue
    }

    if (!campaignMaster.has(campaignId)) {
      campaignMaster.set(campaignId, {
        service_id: serviceId,
        campaign_id: campaignId,
        campaign_name: String(campaign?.name ?? ''),
        status: String(campaign?.status ?? ''),
        campaign_type: String(campaign?.advertisingChannelType ?? ''),
        budget_amount_micros: budget?.amountMicros != null ? Number(budget.amountMicros) : null,
        bidding_strategy: String(campaign?.biddingStrategyType ?? ''),
        start_date: datePartFromAdsDateTime(
          campaign?.startDateTime ?? campaign?.start_date_time
        ),
        end_date: datePartFromAdsDateTime(
          campaign?.endDateTime ?? campaign?.end_date_time
        ),
        updated_at: new Date().toISOString(),
      })
    }

    campaignDaily.push({
      service_id: serviceId,
      campaign_id: campaignId,
      date,
      impressions: Number(metrics?.impressions ?? 0),
      clicks: Number(metrics?.clicks ?? 0),
      cost_micros: Number(metrics?.costMicros ?? 0),
      conversions: Number(metrics?.conversions ?? 0),
      conversion_value_micros: toMicros(metrics?.conversionsValue ?? 0),
      ctr: finiteNumberOrZero(metrics?.ctr),
      average_cpc_micros: toMicros(metrics?.averageCpc),
    })
  }

  console.info('[google-ads sync] campaign loop', {
    serviceId,
    apiRowCount: campaignRows.length,
    masterDistinct: campaignMaster.size,
    dailyRows: campaignDaily.length,
    campaignSkipNoId,
    campaignSkipNoDate,
  })

  await upsertWithLog(
    admin,
    { serviceId, phase: 'campaign_master' },
    'google_ads_campaigns',
    Array.from(campaignMaster.values()),
    'service_id,campaign_id'
  )
  await upsertWithLog(
    admin,
    { serviceId, phase: 'campaign_daily' },
    'google_ads_campaign_daily',
    campaignDaily,
    'service_id,campaign_id,date'
  )

  const adGroupQuery = `
SELECT
  campaign.id,
  ad_group.id,
  ad_group.name,
  ad_group.status,
  ad_group.cpc_bid_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.ctr,
  metrics.average_cpc,
  segments.date
FROM ad_group
WHERE segments.date BETWEEN '${start}' AND '${end}'
  AND ad_group.status != 'REMOVED'
ORDER BY segments.date DESC
`.trim()

  const adGroupRows = await searchStream({
    accessToken,
    developerToken,
    managerCustomerId,
    customerAccountId: cfg.customer_id,
    query: adGroupQuery,
    debugLabel: 'ad_group',
  })

  const adGroupMaster = new Map<string, Record<string, unknown>>()
  const adGroupDaily: Array<Record<string, unknown>> = []
  let adGroupSkipNoId = 0
  let adGroupSkipNoDate = 0
  for (const r of adGroupRows) {
    const campaign = r.campaign as Record<string, unknown> | undefined
    const adGroup = r.adGroup as Record<string, unknown> | undefined
    const metrics = r.metrics as Record<string, unknown> | undefined
    const segments = r.segments as Record<string, unknown> | undefined
    const campaignId = String(campaign?.id ?? '')
    const adGroupId = String(adGroup?.id ?? '')
    const date = String(segments?.date ?? '')
    if (!adGroupId) {
      adGroupSkipNoId += 1
      continue
    }
    if (!date) {
      adGroupSkipNoDate += 1
      continue
    }

    if (!adGroupMaster.has(adGroupId)) {
      adGroupMaster.set(adGroupId, {
        service_id: serviceId,
        campaign_id: campaignId,
        ad_group_id: adGroupId,
        ad_group_name: String(adGroup?.name ?? ''),
        status: String(adGroup?.status ?? ''),
        cpc_bid_micros: adGroup?.cpcBidMicros != null ? Number(adGroup.cpcBidMicros) : null,
        updated_at: new Date().toISOString(),
      })
    }

    adGroupDaily.push({
      service_id: serviceId,
      campaign_id: campaignId,
      ad_group_id: adGroupId,
      date,
      impressions: Number(metrics?.impressions ?? 0),
      clicks: Number(metrics?.clicks ?? 0),
      cost_micros: Number(metrics?.costMicros ?? 0),
      conversions: Number(metrics?.conversions ?? 0),
      conversion_value_micros: toMicros(metrics?.conversionsValue ?? 0),
      ctr: finiteNumberOrZero(metrics?.ctr),
      average_cpc_micros: toMicros(metrics?.averageCpc),
    })
  }

  console.info('[google-ads sync] ad_group loop', {
    serviceId,
    apiRowCount: adGroupRows.length,
    masterDistinct: adGroupMaster.size,
    dailyRows: adGroupDaily.length,
    adGroupSkipNoId,
    adGroupSkipNoDate,
  })

  await upsertWithLog(
    admin,
    { serviceId, phase: 'ad_group_master' },
    'google_ads_ad_groups',
    Array.from(adGroupMaster.values()),
    'service_id,ad_group_id'
  )
  await upsertWithLog(
    admin,
    { serviceId, phase: 'ad_group_daily' },
    'google_ads_adgroup_daily',
    adGroupDaily,
    'service_id,ad_group_id,date'
  )

  if (cfg.collect_keywords) {
    const keywordQuery = `
SELECT
  campaign.id,
  ad_group.id,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  ad_group_criterion.status,
  ad_group_criterion.quality_info.quality_score,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.ctr,
  metrics.average_cpc,
  segments.date
FROM keyword_view
WHERE segments.date BETWEEN '${start}' AND '${end}'
  AND ad_group_criterion.status != 'REMOVED'
ORDER BY segments.date DESC
`.trim()

    const keywordRows = await searchStream({
      accessToken,
      developerToken,
      managerCustomerId,
      customerAccountId: cfg.customer_id,
      query: keywordQuery,
      debugLabel: 'keyword',
    })

    const keywordMaster = new Map<string, Record<string, unknown>>()
    const keywordDaily: Array<Record<string, unknown>> = []
    let kwSkipNoId = 0
    let kwSkipNoDate = 0
    for (const r of keywordRows) {
      const campaign = r.campaign as Record<string, unknown> | undefined
      const adGroup = r.adGroup as Record<string, unknown> | undefined
      const crit = r.adGroupCriterion as Record<string, unknown> | undefined
      const keyword = (crit?.keyword as Record<string, unknown> | undefined) ?? undefined
      const quality = (crit?.qualityInfo as Record<string, unknown> | undefined) ?? undefined
      const metrics = r.metrics as Record<string, unknown> | undefined
      const segments = r.segments as Record<string, unknown> | undefined
      const campaignId = String(campaign?.id ?? '')
      const adGroupId = String(adGroup?.id ?? '')
      const keywordId = String(crit?.criterionId ?? '')
      const date = String(segments?.date ?? '')
      if (!keywordId) {
        kwSkipNoId += 1
        continue
      }
      if (!date) {
        kwSkipNoDate += 1
        continue
      }

      if (!keywordMaster.has(keywordId)) {
        keywordMaster.set(keywordId, {
          service_id: serviceId,
          campaign_id: campaignId,
          ad_group_id: adGroupId,
          keyword_id: keywordId,
          keyword_text: String(keyword?.text ?? ''),
          match_type: String(keyword?.matchType ?? ''),
          status: String(crit?.status ?? ''),
          quality_score: finiteNumberOrZero(quality?.qualityScore),
          updated_at: new Date().toISOString(),
        })
      }

      keywordDaily.push({
        service_id: serviceId,
        campaign_id: campaignId,
        ad_group_id: adGroupId,
        keyword_id: keywordId,
        date,
        impressions: Number(metrics?.impressions ?? 0),
        clicks: Number(metrics?.clicks ?? 0),
        cost_micros: Number(metrics?.costMicros ?? 0),
        conversions: Number(metrics?.conversions ?? 0),
        conversion_value_micros: toMicros(metrics?.conversionsValue ?? 0),
        ctr: finiteNumberOrZero(metrics?.ctr),
        average_cpc_micros: toMicros(metrics?.averageCpc),
        quality_score: finiteNumberOrZero(quality?.qualityScore),
      })
    }

    console.info('[google-ads sync] keyword loop', {
      serviceId,
      apiRowCount: keywordRows.length,
      masterDistinct: keywordMaster.size,
      dailyRows: keywordDaily.length,
      kwSkipNoId,
      kwSkipNoDate,
    })

    await upsertWithLog(
      admin,
      { serviceId, phase: 'keyword_master' },
      'google_ads_keywords',
      Array.from(keywordMaster.values()),
      'service_id,keyword_id'
    )
    await upsertWithLog(
      admin,
      { serviceId, phase: 'keyword_daily' },
      'google_ads_keyword_daily',
      keywordDaily,
      'service_id,keyword_id,date'
    )
  }

  await touchLastSyncedAt(admin, serviceId)

  console.info('[google-ads sync] done', { serviceId })
}
