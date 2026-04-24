export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { validateBatchRequest } from '@/lib/utils/batch-auth'
import { runGbpDailyBatch } from '@/lib/batch/jobs/gbp-daily-batch'

export async function GET(request: NextRequest) {
  if (validateBatchRequest(request)) {
    return handle(request)
  }
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    const qSecret = new URL(request.url).searchParams.get('secret')
    const provided = authHeader?.replace(/^Bearer\s+/i, '')?.trim() ?? qSecret ?? ''
    if (provided !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  return handle(request)
}

export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(request)
}

async function handle(request: NextRequest) {
  const admin = createSupabaseAdminClient()
  const siteId = new URL(request.url).searchParams.get('site_id')
  const result = await runGbpDailyBatch(admin, { siteId })
  if (result.error) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 })
  }
  return NextResponse.json(result)
}
