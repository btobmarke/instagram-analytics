export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { runLineOamDailyBatch } from '@/lib/batch/jobs/line-oam-daily-batch'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.BATCH_SECRET
  if (secret) {
    const auth =
      req.headers.get('authorization')?.replace('Bearer ', '') ??
      new URL(req.url).searchParams.get('secret') ??
      ''
    if (auth !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.BATCH_SECRET
  if (secret) {
    const auth =
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')?.trim() ??
      new URL(req.url).searchParams.get('secret') ??
      ''
    if (auth !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

async function handle(req: NextRequest) {
  const admin = createSupabaseAdminClient()
  let serviceId: string | null = null
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    serviceId =
      typeof (body as { service_id?: string }).service_id === 'string'
        ? (body as { service_id: string }).service_id
        : null
  } else {
    serviceId = new URL(req.url).searchParams.get('service_id')
  }

  const result = await runLineOamDailyBatch(admin, { serviceId })
  if (result.error) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 })
  }
  return NextResponse.json(result)
}
