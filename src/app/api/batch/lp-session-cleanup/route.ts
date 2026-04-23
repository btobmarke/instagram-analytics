import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/batch/lp-session-cleanup
 * LP セッションタイムアウト処理バッチ (BAT-LP-01)
 *
 * ended_at IS NULL のセッションのうち、
 * last_activity_at が session_timeout_minutes 以上前のものを強制終了する。
 *
 * 推奨実行頻度: 30分〜1時間おき
 */
export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('lp-session-cleanup', request)
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'バッチ認証に失敗しました' } },
      { status: 401 }
    )
  }

  const supabase = createServiceRoleClient()
  const startedAt = new Date().toISOString()
  const now = new Date()

  const url = new URL(request.url)
  const lpSiteIdFilter = url.searchParams.get('lp_site_id')

  // アクティブな LP サイトとそれぞれのタイムアウト設定を取得
  let siteQ = supabase
    .from('lp_sites')
    .select('id, session_timeout_minutes')
    .eq('is_active', true)
  if (lpSiteIdFilter) siteQ = siteQ.eq('id', lpSiteIdFilter)
  const { data: lpSites, error: siteError } = await siteQ

  if (siteError) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: 'LP一覧取得に失敗しました' } },
      { status: 500 }
    )
  }

  let totalClosed = 0
  let totalErrors = 0
  const siteResults: Array<{ lpSiteId: string; closed: number; error?: string }> = []

  for (const lpSite of lpSites ?? []) {
    try {
      const timeoutMs = lpSite.session_timeout_minutes * 60 * 1000
      const cutoff = new Date(now.getTime() - timeoutMs).toISOString()

      // タイムアウトしたセッションを取得
      const { data: timedOutSessions, error: fetchError } = await supabase
        .from('lp_sessions')
        .select('id, started_at, last_activity_at')
        .eq('lp_site_id', lpSite.id)
        .is('ended_at', null)
        .lt('last_activity_at', cutoff)

      if (fetchError) {
        totalErrors++
        siteResults.push({ lpSiteId: lpSite.id, closed: 0, error: fetchError.message })
        continue
      }

      const sessions = timedOutSessions ?? []
      if (sessions.length === 0) {
        siteResults.push({ lpSiteId: lpSite.id, closed: 0 })
        continue
      }

      // 各セッションを終了処理
      let closedCount = 0
      for (const session of sessions) {
        const endedAt = session.last_activity_at // 最終アクティビティ時刻を終了時刻とする
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
          .is('ended_at', null) // 競合防止: 他のプロセスが先に閉じていた場合はスキップ

        if (!updateError) {
          closedCount++
        }
      }

      totalClosed += closedCount
      siteResults.push({ lpSiteId: lpSite.id, closed: closedCount })

      console.log(
        `[lp-session-cleanup] lpSiteId=${lpSite.id} タイムアウト対象=${sessions.length} 終了処理=${closedCount}`
      )
    } catch (err) {
      totalErrors++
      siteResults.push({
        lpSiteId: lpSite.id,
        closed: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const finishedAt = new Date().toISOString()

  console.log(
    `[lp-session-cleanup] 完了 サイト数=${lpSites?.length ?? 0} 終了セッション合計=${totalClosed} エラー=${totalErrors}`
  )

  if (totalErrors === 0) {
    await notifyBatchSuccess({
      jobName: 'lp_session_cleanup',
      processed: totalClosed,
      executedAt: new Date(startedAt),
      lines: [
        `対象サイト数: ${lpSites?.length ?? 0}`,
        `終了セッション合計: ${totalClosed}`,
      ],
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

  return NextResponse.json({
    success: true,
    data: {
      processedSites: lpSites?.length ?? 0,
      totalSessionsClosed: totalClosed,
      errorCount: totalErrors,
      startedAt,
      finishedAt,
      siteResults,
    },
  })
}

// Vercel Cron は GET で呼び出す
export async function GET(request: NextRequest) {
  return POST(request)
}
