export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { InstagramApiError, InstagramClient, isRateLimitExceeded } from '@/lib/instagram/client'
import { decrypt } from '@/lib/utils/crypto'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

// POST /api/batch/media-collector
// Vercel Cron or manual trigger: 投稿一覧の同期
export async function POST(request: Request) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  const startedAt = new Date()
  let totalProcessed = 0
  let totalFailed = 0
  let skippedNoToken = 0
  let lastErrorMessage: string | null = null
  let tokenInvalid = false

  // バッチ開始ログ
  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'daily_media_collector',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  console.info('[media-collector] start', { job_id: jobLog?.id ?? null })

  try {
    // アクティブなアカウント一覧取得
    const { data: accounts } = await admin
      .from('ig_accounts')
      .select('id, platform_account_id, api_base_url, api_version')
      .eq('status', 'active')

    for (const account of (accounts ?? [])) {
      try {
        // トークン取得
        const { data: tokenRow } = await admin
          .from('ig_account_tokens')
          .select('access_token_enc')
          .eq('account_id', account.id)
          .eq('is_active', true)
          .single()

        if (!tokenRow) {
          skippedNoToken++
          console.warn('[media-collector] skip account (no active token)', { account_id: account.id })
          continue
        }

        const accessToken = decrypt(tokenRow.access_token_enc)
        const igClient = new InstagramClient(accessToken, account.platform_account_id, {
          apiBaseUrl: account.api_base_url ?? undefined,
          apiVersion: account.api_version ?? undefined,
        })

        // 直近90日分の投稿を取得
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
              totalProcessed++
            } catch (rowErr) {
              totalFailed++
              console.error('[media-collector] upsert row failed', account.id, rowErr)
            }
          }

          after = paging?.cursors?.after
          if (!paging?.next || !after) break
          pageCount++
        }
      } catch (loopErr) {
        totalFailed++
        const msg = loopErr instanceof Error ? loopErr.message : String(loopErr)
        lastErrorMessage = msg
        if (loopErr instanceof InstagramApiError && loopErr.apiError?.code === 190) {
          tokenInvalid = true
        }
        console.error('[media-collector] account failed', { account_id: account.id, error: loopErr })
      }
    }

    const duration = Date.now() - startedAt.getTime()
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: totalFailed === 0 ? 'success' : 'partial',
        records_processed: totalProcessed,
        records_failed: totalFailed,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      }).eq('id', jobLog.id)
    }

    console.info('[media-collector] done', {
      job_id: jobLog?.id ?? null,
      processed: totalProcessed,
      failed: totalFailed,
      skipped_no_token: skippedNoToken,
      token_invalid: tokenInvalid,
      duration_ms: duration,
      status: totalFailed === 0 ? 'success' : 'partial',
    })

    if (totalFailed === 0) {
      await notifyBatchSuccess({
        jobName: 'daily_media_collector',
        processed: totalProcessed,
        executedAt: startedAt,
        lines: [
          `対象: アカウント数 ${(accounts ?? []).length} 件`,
          `トークン未設定でスキップ: ${skippedNoToken} 件`,
        ],
      })
    } else {
      await notifyBatchError({
        jobName: 'daily_media_collector',
        processed: totalProcessed,
        errorCount: totalFailed,
        errors: [{ error: lastErrorMessage ?? `${totalFailed} 件の処理で失敗しました` }],
        executedAt: startedAt,
      })
    }

    return NextResponse.json({
      success: totalFailed === 0,
      processed: totalProcessed,
      failed: totalFailed,
      accounts: (accounts ?? []).length,
      skipped_no_token: skippedNoToken,
      ...(tokenInvalid ? { token_invalid: true as const } : {}),
      ...(lastErrorMessage ? { last_error: lastErrorMessage } : {}),
      ...(tokenInvalid
        ? {
            hint_ja:
              'アクセストークンが無効です（期限切れ・ログアウト・権限失効）。Meta で新しい長期トークンを発行し、アカウントのトークンを差し替えてください。',
          }
        : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[media-collector] fatal', { job_id: jobLog?.id ?? null, error: message }, err)
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'daily_media_collector',
      processed: 0,
      errorCount: 1,
      errors: [{ error: message }],
      executedAt: startedAt,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel Cron は GET で呼び出す
export async function GET(request: Request) {
  return POST(request)
}
