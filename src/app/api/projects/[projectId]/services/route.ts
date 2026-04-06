import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'

const SERVICE_TYPES = ['instagram', 'lp', 'x', 'line', 'google_ads', 'meta_ads', 'gbp', 'owned_media', 'summary'] as const

const LpConfigSchema = z.object({
  lp_name: z.string().min(1).max(255),
  lp_code: z.string().min(1).max(255),
  target_url: z.string().min(1).max(500),
  session_timeout_minutes: z.number().int().min(1).max(1440).optional().default(30),
  ga4_property_id: z.string().optional(),
  clarity_project_id: z.string().optional(),
  clarity_api_key: z.string().optional(),
  hot_threshold: z.number().int().min(0).optional().default(100),
})

const InstagramConfigSchema = z.object({
  ig_account_ref_id: z.string().uuid().optional(),
  username: z.string().optional(),
})

const CreateServiceSchema = z.object({
  service_type: z.enum(SERVICE_TYPES),
  service_name: z.string().min(1).max(255),
  display_order: z.number().int().min(0).optional().default(0),
  config: z.record(z.unknown()).optional(),
})

// POST /api/projects/:projectId/services - サービス登録
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, { status: 401 })

  // プロジェクト存在確認
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).single()
  if (!project) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '指定されたプロジェクトが存在しません' } }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = CreateServiceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? '入力値が不正です' } }, { status: 400 })
  }

  const { service_type, service_name, display_order, config } = parsed.data

  // services テーブルに登録
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .insert({ project_id: projectId, service_type, service_name, display_order })
    .select('id, project_id, service_type, service_name, display_order, is_active, created_at, updated_at')
    .single()

  if (serviceError || !service) {
    console.error('[POST /api/projects/:id/services] services insert', serviceError)
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: 'サービス登録に失敗しました' } }, { status: 500 })
  }

  // サービス種別ごとの追加登録
  if (service_type === 'lp' && config) {
    const lpParsed = LpConfigSchema.safeParse(config)
    if (!lpParsed.success) {
      await supabase.from('services').delete().eq('id', service.id)
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'LP設定が不正です: ' + lpParsed.error.errors[0]?.message } }, { status: 400 })
    }

    const lpData = lpParsed.data

    // LP_IDの重複チェック
    const { data: existing } = await supabase.from('lp_sites').select('id').eq('lp_code', lpData.lp_code).single()
    if (existing) {
      await supabase.from('services').delete().eq('id', service.id)
      return NextResponse.json({ success: false, error: { code: 'DUPLICATE_LP_CODE', message: 'このLP_IDはすでに使用されています' } }, { status: 400 })
    }

    // APIキー生成（平文は返却のみ、DBにはハッシュ保存）
    const rawApiKey = `lp_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')}`
    const apiKeyHash = createHash('sha256').update(rawApiKey).digest('hex')

    const { error: lpError } = await supabase.from('lp_sites').insert({
      service_id: service.id,
      lp_code: lpData.lp_code,
      lp_name: lpData.lp_name,
      target_url: lpData.target_url,
      session_timeout_minutes: lpData.session_timeout_minutes,
      api_auth_key_hash: apiKeyHash,
    })

    if (lpError) {
      await supabase.from('services').delete().eq('id', service.id)
      console.error('[POST /services] lp_sites insert', lpError)
      return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: 'LP設定の登録に失敗しました' } }, { status: 500 })
    }

    // lp_scoring_settings 初期値登録
    await supabase.from('lp_scoring_settings').insert({
      lp_site_id: (await supabase.from('lp_sites').select('id').eq('service_id', service.id).single()).data?.id,
      hot_threshold: lpData.hot_threshold,
    })

    // GA4連携情報
    if (lpData.ga4_property_id) {
      await supabase.from('service_integrations').insert({
        service_id: service.id,
        integration_type: 'GA4',
        external_project_id: lpData.ga4_property_id,
      })
    }

    // Clarity連携情報
    if (lpData.clarity_project_id) {
      await supabase.from('service_integrations').insert({
        service_id: service.id,
        integration_type: 'CLARITY',
        external_project_id: lpData.clarity_project_id,
        encrypted_credential: lpData.clarity_api_key ?? null,
      })
    }

    return NextResponse.json({ success: true, data: { ...service, api_key: rawApiKey } }, { status: 201 })
  }

  if (service_type === 'instagram' && config) {
    const igParsed = InstagramConfigSchema.safeParse(config)
    // ig_account_ref_id が指定されている場合は ig_accounts.service_id を更新して紐づける
    if (igParsed.success && igParsed.data.ig_account_ref_id) {
      await supabase
        .from('ig_accounts')
        .update({ service_id: service.id })
        .eq('id', igParsed.data.ig_account_ref_id)
    }
  }

  return NextResponse.json({ success: true, data: service }, { status: 201 })
}
