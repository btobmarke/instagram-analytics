import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

/**
 * プラットフォーム強制終了や未捕捉例外で `finished_at` が付かず `running` のまま残る行を掃除する。
 * 閾値は「通常実行が超えない想定」より十分長く、毎時 Cron と重なっても誤判定しない程度に取る。
 */
export async function closeStaleRunningBatchLogs(
  admin: AdminClient,
  jobNames: readonly string[],
  staleAfterMs: number = 20 * 60 * 1000
): Promise<void> {
  const thresholdIso = new Date(Date.now() - staleAfterMs).toISOString()
  const msg =
    'Stale running: closed by subsequent batch start (likely platform timeout or process crash before finally).'

  for (const jobName of jobNames) {
    const { data: rows, error } = await admin
      .from('batch_job_logs')
      .select('id, started_at')
      .eq('job_name', jobName)
      .eq('status', 'running')
      .is('finished_at', null)
      .lt('started_at', thresholdIso)
      .limit(50)

    if (error) {
      console.warn('[batch] stale running log scan failed', {
        job_name: jobName,
        error: error.message,
      })
      continue
    }

    for (const row of rows ?? []) {
      const startedMs = new Date(row.started_at).getTime()
      const durationMs = Number.isFinite(startedMs) ? Date.now() - startedMs : null
      const { error: updErr } = await admin
        .from('batch_job_logs')
        .update({
          status: 'failed',
          error_message: msg,
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
        })
        .eq('id', row.id)

      if (updErr) {
        console.warn('[batch] stale running log close failed', {
          id: row.id,
          error: updErr.message,
        })
      } else {
        console.info('[batch] closed stale running log', { job_name: jobName, id: row.id })
      }
    }
  }
}
