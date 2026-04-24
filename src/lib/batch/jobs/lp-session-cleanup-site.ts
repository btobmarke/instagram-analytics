import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

function createServiceRoleClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/**
 * LP セッションタイムアウト（1 サイト or 全サイト）。キュー・Route 共通。
 */
export async function runLpSessionCleanupBatch(opts: { lpSiteId: string | null }): Promise<void> {
  const supabase = createServiceRoleClient()
  const startedAt = new Date().toISOString()
  const now = new Date()
  const { lpSiteId } = opts

  let siteQ = supabase.from('lp_sites').select('id, session_timeout_minutes').eq('is_active', true)
  if (lpSiteId) siteQ = siteQ.eq('id', lpSiteId)
  const { data: lpSites, error: siteError } = await siteQ

  if (siteError) {
    throw new Error(siteError.message)
  }

  let totalClosed = 0
  let totalErrors = 0

  for (const lpSite of lpSites ?? []) {
    try {
      const timeoutMs = lpSite.session_timeout_minutes * 60 * 1000
      const cutoff = new Date(now.getTime() - timeoutMs).toISOString()

      const { data: timedOutSessions, error: fetchError } = await supabase
        .from('lp_sessions')
        .select('id, started_at, last_activity_at')
        .eq('lp_site_id', lpSite.id)
        .is('ended_at', null)
        .lt('last_activity_at', cutoff)

      if (fetchError) {
        totalErrors++
        continue
      }

      const sessions = timedOutSessions ?? []
      if (sessions.length === 0) continue

      let closedCount = 0
      for (const session of sessions) {
        const endedAt = session.last_activity_at
        const durationSeconds = Math.round(
          (new Date(endedAt).getTime() - new Date(session.started_at).getTime()) / 1000
        )

        const { error: updateError } = await supabase
          .from('lp_sessions')
          .update({
            ended_at: endedAt,
            duration_seconds: durationSeconds > 0 ? durationSeconds : 0,
          })
          .eq('id', session.id)
          .is('ended_at', null)

        if (!updateError) closedCount++
      }

      totalClosed += closedCount
    } catch {
      totalErrors++
    }
  }

  if (totalErrors === 0) {
    await notifyBatchSuccess({
      jobName: 'lp_session_cleanup',
      processed: totalClosed,
      executedAt: new Date(startedAt),
      lines: [`対象サイト数: ${lpSites?.length ?? 0}`, `終了セッション合計: ${totalClosed}`],
    })
  } else {
    await notifyBatchError({
      jobName: 'lp_session_cleanup',
      processed: totalClosed,
      errorCount: totalErrors,
      errors: [{ error: `${totalErrors} 件のサイトでクリーンアップに失敗しました` }],
      executedAt: new Date(startedAt),
    })
  }
}
