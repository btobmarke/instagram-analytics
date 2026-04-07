import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { encryptPassphrase } from '@/lib/line-oam/crypto'

type Params = { params: Promise<{ clientId: string }> }

// GET: セッション情報（暗号文なし・メタ情報のみ）
export async function GET(_req: NextRequest, { params }: Params) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('line_oam_sessions')
    .select('id, client_id, label, status, last_used_at, created_at, updated_at, encrypted_passphrase')
    .eq('client_id', clientId)
    .single()

  if (!data) return NextResponse.json({ success: true, data: null })

  return NextResponse.json({
    success: true,
    data: {
      id:                   data.id,
      client_id:            data.client_id,
      label:                data.label,
      status:               data.status,
      last_used_at:         data.last_used_at,
      created_at:           data.created_at,
      updated_at:           data.updated_at,
      has_passphrase:       !!data.encrypted_passphrase,
    },
  })
}

// POST: セッション登録 or 更新
// body: { format_version, cipher, kdf, nonce_b64, ciphertext_b64, passphrase?, label? }
export async function POST(req: NextRequest, { params }: Params) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.kdf || !body?.nonce_b64 || !body?.ciphertext_b64) {
    return NextResponse.json({ error: 'kdf, nonce_b64, ciphertext_b64 は必須です' }, { status: 400 })
  }

  // パスフレーズが送られてきた場合は KEK で暗号化して保存
  let encrypted_passphrase: string | null = null
  if (body.passphrase) {
    try {
      encrypted_passphrase = encryptPassphrase(body.passphrase)
    } catch {
      return NextResponse.json({ error: 'パスフレーズの暗号化に失敗しました' }, { status: 500 })
    }
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_oam_sessions')
    .upsert({
      client_id:            clientId,
      format_version:       body.format_version ?? 1,
      cipher:               body.cipher ?? 'AES-256-GCM',
      kdf:                  body.kdf,
      nonce_b64:            body.nonce_b64,
      ciphertext_b64:       body.ciphertext_b64,
      encrypted_passphrase: encrypted_passphrase,
      label:                body.label ?? null,
      status:               'active',
      created_by_user_id:   user.id,
      updated_at:           new Date().toISOString(),
    }, { onConflict: 'client_id' })
    .select('id, status, updated_at')
    .single()

  if (error) {
    console.error('[POST line-oam/session]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}

// DELETE: セッションを revoked に設定
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { clientId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('line_oam_sessions')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('client_id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
