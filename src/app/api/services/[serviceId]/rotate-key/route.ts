import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/services/:serviceId/rotate-key
 *
 * LP SDK の APIキーを再発行する。
 * 新しいキーの SHA-256 ハッシュを lp_sites.api_auth_key_hash に保存し、
 * 生のキーを一度だけレスポンスで返す。
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // サービスの存在確認（権限チェックを兼ねる）
  const { data: service, error: svcErr } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .single()

  if (svcErr || !service) {
    return NextResponse.json({ error: 'サービスが見つかりません' }, { status: 404 })
  }
  if (service.service_type !== 'lp') {
    return NextResponse.json({ error: 'LP サービスのみ対応しています' }, { status: 400 })
  }

  // 新しい API キーを生成
  const rawApiKey = `lp_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')}`
  const apiKeyHash = createHash('sha256').update(rawApiKey).digest('hex')

  // lp_sites のハッシュを更新
  const admin = createSupabaseAdminClient()
  const { error: updateErr } = await admin
    .from('lp_sites')
    .update({ api_auth_key_hash: apiKeyHash })
    .eq('service_id', serviceId)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // 生のキーを一度だけ返す（DB には保存しない）
  return NextResponse.json({ success: true, api_key: rawApiKey })
}
