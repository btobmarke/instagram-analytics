import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ serviceId: string }> }

const MAX_RANGE_DAYS = 800

/**
 * GET /api/services/[serviceId]/line-oam/txn-threshold-users
 * 付与ログ（line_oam_rewardcard_txns）を都度集計し、期間内の取引が minCount 回以上ある顧客数を返す。
 *
 * Query:
 *   rangeStart, rangeEnd … YYYY-MM-DD（JST 暦日、両端含む）
 *   minCount … 1 以上の整数（「X回以上来店」）
 *   rewardcardId … 任意。line_oam_rewardcards.id（省略時は当該サービスの全カード合算）
 *   pointType … 任意。LINE CSV の Point Type と完全一致でフィルタ（来店のみに絞る場合に利用）
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  const { data: svc, error: svcErr } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .single()

  if (svcErr || !svc || svc.service_type !== 'line') {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'LINE サービスが見つかりません' } },
      { status: 404 },
    )
  }

  const sp = req.nextUrl.searchParams
  const rangeStart = sp.get('rangeStart')?.slice(0, 10) ?? ''
  const rangeEnd = sp.get('rangeEnd')?.slice(0, 10) ?? ''
  const minCountRaw = sp.get('minCount')
  const rewardcardId = sp.get('rewardcardId')?.trim() || null
  const pointType = sp.get('pointType')?.trim() || null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'rangeStart / rangeEnd は YYYY-MM-DD で指定してください' } },
      { status: 400 },
    )
  }

  if (rangeStart > rangeEnd) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'rangeStart は rangeEnd 以下にしてください' } },
      { status: 400 },
    )
  }

  const minCount = minCountRaw != null ? Number.parseInt(minCountRaw, 10) : Number.NaN
  if (!Number.isFinite(minCount) || minCount < 1) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'minCount は 1 以上の整数を指定してください' } },
      { status: 400 },
    )
  }

  const startMs = Date.parse(`${rangeStart}T00:00:00+09:00`)
  const endMs = Date.parse(`${rangeEnd}T00:00:00+09:00`)
  const days = Math.floor((endMs - startMs) / 86400000) + 1
  if (days > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: `集計期間は最大 ${MAX_RANGE_DAYS} 日までです` } },
      { status: 400 },
    )
  }

  const admin = createSupabaseAdminClient()

  if (rewardcardId) {
    const { data: rc } = await admin
      .from('line_oam_rewardcards')
      .select('id')
      .eq('id', rewardcardId)
      .eq('service_id', serviceId)
      .maybeSingle()
    if (!rc) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'rewardcardId がこのサービスに存在しません' } },
        { status: 400 },
      )
    }
  }

  const { data: rows, error: rpcErr } = await admin.rpc('line_oam_users_meeting_min_txn_count', {
    p_service_id: serviceId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
    p_min_count: minCount,
    p_line_rewardcard_id: rewardcardId,
    p_point_type: pointType,
  })

  if (rpcErr) {
    return NextResponse.json(
      { success: false, error: { code: 'RPC_ERROR', message: rpcErr.message } },
      { status: 500 },
    )
  }

  const row = Array.isArray(rows) ? rows[0] : rows
  const qualifyingUserCount = row?.qualifying_user_count != null ? Number(row.qualifying_user_count) : 0
  const txnRowCountInRange = row?.txn_row_count_in_range != null ? Number(row.txn_row_count_in_range) : 0

  return NextResponse.json({
    success: true,
    data: {
      qualifyingUserCount,
      txnRowCountInRange,
      rangeStart,
      rangeEnd,
      minCount,
      rewardcardId,
      pointType,
      note:
        '1行=LINEのポイント取引CSVの1付与イベント。来店のみに絞る場合は pointType に CSV の Point Type 値を指定してください。',
    },
  })
}
