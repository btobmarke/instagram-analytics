export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { BatchJobLog } from '@/types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  BATCH_STATUS_JOB_GROUPS,
  mergeBatchJobLogGroups,
} from '@/lib/batch/batch-status-logs'

// GET /api/batch/status?limit=50
// ログはカテゴリ別に直近 N 件ずつ取得してマージする（キュー分割で gbp_daily 等が
// 「直近 limit 件」から押し出されないようにする）。
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(200, Math.max(10, parseInt(searchParams.get('limit') ?? '50', 10)))
  const perGroup = Math.min(100, Math.max(5, parseInt(searchParams.get('per_group') ?? '15', 10)))

  const jobNameLists = Object.values(BATCH_STATUS_JOB_GROUPS)
  const results = await Promise.all(
    jobNameLists.map((names) =>
      supabase
        .from('batch_job_logs')
        .select('*')
        .in('job_name', [...names])
        .order('started_at', { ascending: false })
        .limit(perGroup),
    ),
  )

  const firstErr = results.find((r) => r.error)?.error
  if (firstErr) return NextResponse.json({ error: firstErr.message }, { status: 500 })

  const logs = mergeBatchJobLogGroups(
    results.map((r) => (r.data ?? []) as BatchJobLog[]),
  ).slice(0, limit)

  const { data: schedules } = await supabase
    .from('batch_job_schedules')
    .select('*')
    .order('job_name')

  return NextResponse.json({ data: { logs, schedules } })
}
