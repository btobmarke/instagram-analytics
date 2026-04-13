/**
 * GET /api/services/[serviceId]/summary/data
 *
 * サマリービュー用 集計データ取得エンドポイント
 *
 * Query params:
 *   fields    カンマ区切り "table.field" リスト
 *   timeUnit  day | week | month | hour | custom_range (default: day)
 *   count     期間数 (default: 8) ※ custom_range では無視
 *   rangeStart / rangeEnd  YYYY-MM-DD（timeUnit=custom_range のとき必須）
 *
 * Response:
 *   { success: true, data: { [fieldRef]: { [timeLabel]: number | null } } }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildPeriods, fetchMetricsByRefs } from '@/lib/summary/fetch-metrics'
import type { TimeUnit } from '@/lib/summary/fetch-metrics'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    )
  }

  // クエリパラメータ解析
  const url = new URL(req.url)
  const rawFields = url.searchParams.get('fields') ?? ''
  const timeUnit  = (url.searchParams.get('timeUnit') ?? 'day') as TimeUnit
  const count     = Math.min(parseInt(url.searchParams.get('count') ?? '8', 10), 24)
  const rangeStartParam = url.searchParams.get('rangeStart')?.slice(0, 10)
  const rangeEndParam   = url.searchParams.get('rangeEnd')?.slice(0, 10)

  if (!rawFields) {
    return NextResponse.json({ success: true, data: {} })
  }

  const fieldRefs = rawFields.split(',').map(s => s.trim()).filter(Boolean)

  const periodsOrError = buildPeriods(timeUnit, count, rangeStartParam, rangeEndParam)
  if ('error' in periodsOrError) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: periodsOrError.error } },
      { status: 400 },
    )
  }

  const merged = await fetchMetricsByRefs(supabase, serviceId, fieldRefs, periodsOrError)

  return NextResponse.json({ success: true, data: merged })
}
