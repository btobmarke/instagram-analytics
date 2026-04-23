import type { SupabaseClient } from '@supabase/supabase-js'
import { InstagramApiError, InstagramClient, isRateLimitExceeded } from '@/lib/instagram/client'
import { resolveClientIdFromServiceJoin } from '@/lib/batch/resolve-service-client-id'
import { decrypt } from '@/lib/utils/crypto'
import { upsertActiveStoriesPages } from '@/lib/batch/sync-instagram-stories-media'

export type MediaCollectorAccountRow = {
  id: string
  platform_account_id: string
  api_base_url: string | null
  api_version: string | null
  service_id: string | null
}

export type MediaCollectorOneAccountResult = {
  processed: number
  failed: number
  skippedNoToken: boolean
  skippedNoClient: boolean
  storyListFetchFailures: number
  storyRateLimitEarlyStops: number
  tokenInvalid: boolean
}

export async function runMediaCollectorForAccount(
  admin: SupabaseClient,
  account: MediaCollectorAccountRow
): Promise<MediaCollectorOneAccountResult> {
  let processed = 0
  let failed = 0
  let skippedNoToken = false
  let skippedNoClient = false
  let storyListFetchFailures = 0
  let storyRateLimitEarlyStops = 0
  let tokenInvalid = false

  try {
    const { data: svcRow } = await admin
      .from('services')
      .select('project_id, projects!inner(client_id)')
      .eq('id', account.service_id!)
      .single()

    const clientId = resolveClientIdFromServiceJoin(svcRow)
    if (!clientId) {
      skippedNoClient = true
      return {
        processed: 0,
        failed: 0,
        skippedNoToken,
        skippedNoClient,
        storyListFetchFailures,
        storyRateLimitEarlyStops,
        tokenInvalid,
      }
    }

    const { data: tokenRow } = await admin
      .from('client_ig_tokens')
      .select('access_token_enc')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .single()

    if (!tokenRow) {
      skippedNoToken = true
      return {
        processed: 0,
        failed: 0,
        skippedNoToken,
        skippedNoClient,
        storyListFetchFailures,
        storyRateLimitEarlyStops,
        tokenInvalid,
      }
    }

    const accessToken = decrypt(tokenRow.access_token_enc)
    const igClient = new InstagramClient(accessToken, account.platform_account_id, {
      apiBaseUrl: account.api_base_url ?? undefined,
      apiVersion: account.api_version ?? undefined,
    })

    const upsertIgMediaRow = async (m: Record<string, unknown>) => {
      await admin.from('ig_media').upsert({
        account_id: account.id,
        platform_media_id: m.id as string,
        media_type: m.media_type as string,
        media_product_type: m.media_product_type as string | null,
        caption: m.caption as string | null,
        permalink: m.permalink as string | null,
        thumbnail_url: m.thumbnail_url as string | null,
        media_url: m.media_url as string | null,
        children_json: m.children ?? null,
        posted_at: m.timestamp as string,
        shortcode: m.shortcode as string | null,
        is_comment_enabled: m.is_comment_enabled as boolean | null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id,platform_media_id' })
    }

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    let after: string | undefined
    let pageCount = 0

    while (pageCount < 10) {
      const { data: response, paging, rateUsage } = await igClient.getMediaList({ limit: 50, after, since })
      if (isRateLimitExceeded(rateUsage, 70)) break

      const mediaList = (response as { data: unknown[] })?.data ?? []

      for (const media of mediaList) {
        const m = media as Record<string, unknown>
        try {
          await upsertIgMediaRow(m)
          processed++
        } catch (rowErr) {
          failed++
          console.error('[media-collector] upsert row failed', account.id, rowErr)
        }
      }

      after = paging?.cursors?.after
      if (!paging?.next || !after) break
      pageCount++
    }

    const st = await upsertActiveStoriesPages(igClient, upsertIgMediaRow, {
      accountId: account.id,
      logPrefix: 'media-collector',
    })
    if (st.listFetchFailed) storyListFetchFailures += 1
    if (st.rateLimitStoppedEarly) storyRateLimitEarlyStops += 1
    processed += st.processed
    failed += st.failed

    return {
      processed,
      failed,
      skippedNoToken,
      skippedNoClient,
      storyListFetchFailures,
      storyRateLimitEarlyStops,
      tokenInvalid,
    }
  } catch (loopErr) {
    failed++
    if (loopErr instanceof InstagramApiError && loopErr.apiError?.code === 190) {
      tokenInvalid = true
    }
    console.error('[media-collector] account failed', { account_id: account.id, error: loopErr })
    return {
      processed,
      failed,
      skippedNoToken,
      skippedNoClient,
      storyListFetchFailures,
      storyRateLimitEarlyStops,
      tokenInvalid,
    }
  }
}
