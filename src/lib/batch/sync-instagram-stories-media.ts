import type { SupabaseClient } from '@supabase/supabase-js'
import { InstagramClient, isRateLimitExceeded } from '@/lib/instagram/client'
import { resolveClientIdFromServiceJoin } from '@/lib/batch/resolve-service-client-id'
import { decrypt } from '@/lib/utils/crypto'

export type UpsertIgMediaRowFn = (m: Record<string, unknown>) => Promise<void>

/**
 * GET /{ig-user-id}/stories をページング取得し、ig_media に upsert する。
 * API 全体の失敗は throw せず processed/failed のみ返す（呼び出し側でログ）。
 */
export async function upsertActiveStoriesPages(
  igClient: InstagramClient,
  upsertRow: UpsertIgMediaRowFn,
  ctx: { accountId: string; logPrefix: string }
): Promise<{ processed: number; failed: number }> {
  let processed = 0
  let failed = 0

  try {
    let storyAfter: string | undefined
    let storyPages = 0
    while (storyPages < 5) {
      const { data: storyResp, paging: storyPaging, rateUsage } =
        await igClient.getStoriesList({ limit: 50, after: storyAfter })
      if (isRateLimitExceeded(rateUsage, 70)) break

      const storyList = (storyResp as { data?: unknown[] })?.data ?? []

      for (const media of storyList) {
        const m = media as Record<string, unknown>
        try {
          await upsertRow(m)
          processed++
        } catch (rowErr) {
          failed++
          console.error(`[${ctx.logPrefix}] stories upsert row failed`, ctx.accountId, rowErr)
        }
      }

      storyAfter = storyPaging?.cursors?.after
      if (!storyPaging?.next || !storyAfter) break
      storyPages++
    }
  } catch (storiesErr) {
    console.warn(`[${ctx.logPrefix}] stories list fetch failed (non-fatal)`, {
      account_id: ctx.accountId,
      error: storiesErr instanceof Error ? storiesErr.message : String(storiesErr),
    })
  }

  return { processed, failed }
}

export type IgAccountForStorySync = {
  id: string
  platform_account_id: string
  api_base_url: string | null
  api_version: string | null
  service_id: string | null
}

/**
 * アクティブアカウントを走査し、公開中ストーリーのみ ig_media に反映する（毎時 Cron 用）。
 */
export async function runInstagramStoryMediaSyncAllAccounts(
  admin: SupabaseClient,
  logPrefix: string
): Promise<{
  totalProcessed: number
  totalFailed: number
  skippedNoToken: number
  skippedNoClient: number
  accountsCount: number
}> {
  let totalProcessed = 0
  let totalFailed = 0
  let skippedNoToken = 0
  let skippedNoClient = 0

  const { data: accounts } = await admin
    .from('ig_accounts')
    .select('id, platform_account_id, api_base_url, api_version, service_id')
    .eq('status', 'active')
    .not('service_id', 'is', null)

  const list = (accounts ?? []) as IgAccountForStorySync[]

  for (const account of list) {
    try {
      const { data: svcRow } = await admin
        .from('services')
        .select('project_id, projects!inner(client_id)')
        .eq('id', account.service_id!)
        .single()

      const clientId = resolveClientIdFromServiceJoin(svcRow)
      if (!clientId) {
        skippedNoClient++
        console.warn(`[${logPrefix}] skip account (cannot resolve client)`, {
          account_id: account.id,
          service_id: account.service_id,
        })
        continue
      }

      const { data: tokenRow } = await admin
        .from('client_ig_tokens')
        .select('access_token_enc')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .single()

      if (!tokenRow) {
        skippedNoToken++
        console.warn(`[${logPrefix}] skip account (no active token for client)`, {
          account_id: account.id,
          client_id: clientId,
        })
        continue
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

      const st = await upsertActiveStoriesPages(igClient, upsertIgMediaRow, {
        accountId: account.id,
        logPrefix,
      })
      totalProcessed += st.processed
      totalFailed += st.failed
    } catch (loopErr) {
      totalFailed++
      console.error(`[${logPrefix}] account failed`, { account_id: account.id, error: loopErr })
    }
  }

  return {
    totalProcessed,
    totalFailed,
    skippedNoToken,
    skippedNoClient,
    accountsCount: list.length,
  }
}
