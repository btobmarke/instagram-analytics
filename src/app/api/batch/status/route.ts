export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// GET /api/batch/status?limit=50
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') ?? '50', 10)

  const { data: logs, error } = await supabase
    .from('batch_job_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: schedules } = await supabase
    .from('batch_job_schedules')
    .select('*')
    .order('job_name')

  return NextResponse.json({ data: { logs, schedules } })
}
