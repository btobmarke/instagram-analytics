export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { syncGoogleAdsForServiceConfig } from '@/lib/google-ads/sync-service'

type Params = { params: Promise<{ serviceId: string }> }

// POST /api/services/:serviceId/google-ads/sync — ログインユーザーが手動で日次同期を1サービス分実行
export async function POST(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data: svc, error: svcErr } = await admin
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .single()

  if (svcErr || !svc) {
    return NextResponse.json({ error: 'サービスが見つかりません' }, { status: 404 })
  }
  if (svc.service_type !== 'google_ads') {
    return NextResponse.json({ error: 'Google 広告サービスではありません' }, { status: 400 })
  }

  const { data: cfg, error: cfgErr } = await admin
    .from('google_ads_service_configs')
    .select('service_id, customer_id, collect_keywords, backfill_days, last_synced_at, is_active, time_zone')
    .eq('service_id', serviceId)
    .single()

  if (cfgErr || !cfg) {
    return NextResponse.json({ error: 'Google 広告の設定がまだありません。customer_id を登録してください。' }, { status: 404 })
  }
  if (!cfg.is_active) {
    return NextResponse.json({ error: 'このサービスは無効のため同期できません' }, { status: 400 })
  }

  try {
    await syncGoogleAdsForServiceConfig(admin, {
      service_id: cfg.service_id,
      customer_id: cfg.customer_id,
      collect_keywords: Boolean(cfg.collect_keywords),
      backfill_days: Number(cfg.backfill_days ?? 30),
      last_synced_at: cfg.last_synced_at,
      time_zone: cfg.time_zone,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[google-ads/sync]', { serviceId, msg })
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
