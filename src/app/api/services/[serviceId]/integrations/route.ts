import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/utils/crypto'
import { z } from 'zod'

type Params = { params: Promise<{ serviceId: string }> }

const ALLOWED_TYPES = ['GA4', 'CLARITY', 'INSTAGRAM'] as const
type IntegrationType = typeof ALLOWED_TYPES[number]

// ---------------------------------------------------------------------------
// GET /api/services/[serviceId]/integrations
// 連携設定一覧を取得（credential は除外）
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const { data, error } = await supabase
    .from('service_integrations')
    .select('id, service_id, integration_type, external_project_id, last_synced_at, status, created_at, updated_at')
    .eq('service_id', serviceId)
    .order('integration_type')

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data ?? [] })
}

// ---------------------------------------------------------------------------
// POST /api/services/[serviceId]/integrations
// 連携設定を新規作成または更新（upsert）
// ---------------------------------------------------------------------------

const GA4Schema = z.object({
  integration_type: z.literal('GA4'),
  property_id: z.string().min(1, 'GA4 プロパティ ID を入力してください'),
  service_account_json: z.string().min(1, 'サービスアカウント JSON を入力してください'),
})

const ClaritySchema = z.object({
  integration_type: z.literal('CLARITY'),
  project_id: z.string().min(1, 'Clarity プロジェクト ID を入力してください'),
  api_key: z.string().min(1, 'Clarity API キーを入力してください'),
})

const BodySchema = z.discriminatedUnion('integration_type', [GA4Schema, ClaritySchema])

export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ success: false, error: { code: 'INVALID_BODY' } }, { status: 400 })

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } },
      { status: 422 }
    )
  }

  let externalProjectId: string
  let encryptedCredential: string

  if (parsed.data.integration_type === 'GA4') {
    // サービスアカウント JSON をバリデーション
    try {
      const sa = JSON.parse(parsed.data.service_account_json)
      if (!sa.private_key || !sa.client_email) {
        throw new Error('private_key / client_email が含まれていません')
      }
    } catch (e) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_SA_JSON', message: e instanceof Error ? e.message : 'JSON パースエラー' } },
        { status: 422 }
      )
    }
    externalProjectId = parsed.data.property_id
    encryptedCredential = encrypt(parsed.data.service_account_json)
  } else {
    // CLARITY
    externalProjectId = parsed.data.project_id
    encryptedCredential = encrypt(JSON.stringify({ apiKey: parsed.data.api_key, projectId: parsed.data.project_id }))
  }

  const { data, error } = await supabase
    .from('service_integrations')
    .upsert({
      service_id: serviceId,
      integration_type: parsed.data.integration_type,
      external_project_id: externalProjectId,
      encrypted_credential: encryptedCredential,
      status: 'active',
    }, { onConflict: 'service_id,integration_type' })
    .select('id, service_id, integration_type, external_project_id, last_synced_at, status, created_at, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({ success: true, data }, { status: 200 })
}

// ---------------------------------------------------------------------------
// DELETE /api/services/[serviceId]/integrations?type=GA4
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const integrationType = req.nextUrl.searchParams.get('type') as IntegrationType | null
  if (!integrationType || !ALLOWED_TYPES.includes(integrationType)) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_TYPE' } }, { status: 400 })
  }

  const { error } = await supabase
    .from('service_integrations')
    .delete()
    .eq('service_id', serviceId)
    .eq('integration_type', integrationType)

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
