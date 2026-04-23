import { NextRequest, NextResponse } from 'next/server'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { runLpAggregateBatch } from '@/lib/batch/jobs/lp-aggregate-site'

export async function POST(request: NextRequest) {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('lp-aggregate', request)
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'バッチ認証に失敗しました' } },
      { status: 401 }
    )
  }

  const url = new URL(request.url)
  const lpSiteId = url.searchParams.get('lp_site_id')
  await runLpAggregateBatch({ lpSiteId })

  return NextResponse.json({ success: true })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
