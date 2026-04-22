export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { InstagramClient, InstagramApiError } from '@/lib/instagram/client'
import { resolveClientIdFromServiceJoin } from '@/lib/batch/resolve-service-client-id'
import { decrypt } from '@/lib/utils/crypto'

const API_BASE_URLS_INSTAGRAM = 'https://graph.instagram.com'

function maskPlatformAccountId(id: string | null | undefined): string {
  if (!id) return '(empty)'
  const s = String(id)
  if (s.length <= 4) return '****'
  return `…${s.slice(-4)}`
}

function useInstagramHostFromAccount(apiBaseUrl: string | null | undefined): boolean {
  const base = apiBaseUrl ?? 'https://graph.facebook.com'
  return base === API_BASE_URLS_INSTAGRAM || base.includes('graph.instagram.com')
}

/** 開発時または SYNC_DEBUG=1 のとき API レスポンスに Meta 向け詳細を含める */
function includeSyncErrorDetailsInResponse(): boolean {
  return process.env.SYNC_DEBUG === '1' || process.env.NODE_ENV === 'development'
}

// POST /api/accounts/[id]/sync — Instagramプロフィール情報を同期
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()

  // アカウント取得（API設定 + service_id 含む）
  const { data: account, error: accErr } = await admin
    .from('ig_accounts')
    .select('platform_account_id, api_base_url, api_version, username, service_id')
    .eq('id', id)
    .single()

  if (accErr || !account) {
    return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })
  }

  // service_id → project → client → client_ig_tokens でトークン取得
  if (!account.service_id) {
    return NextResponse.json({ error: 'アカウントがサービスに紐づいていません' }, { status: 400 })
  }

  const { data: svcRow } = await admin
    .from('services')
    .select('project_id, projects!inner(client_id)')
    .eq('id', account.service_id)
    .single()

  const clientId = resolveClientIdFromServiceJoin(svcRow)
  if (!clientId) {
    return NextResponse.json({ error: 'クライアントの解決に失敗しました' }, { status: 500 })
  }

  const { data: tokenRow, error: tokenErr } = await admin
    .from('client_ig_tokens')
    .select('access_token_enc')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .single()

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'クライアントに Instagram トークンが登録されていません。クライアント設定からトークンを登録してください。' }, { status: 404 })
  }

  if (!account.username?.trim()) {
    return NextResponse.json(
      { error: '同期にはユーザー名が必要です。アカウントの「ユーザー名」（@なし）を登録してから再度お試しください。' },
      { status: 400 }
    )
  }

  try {
    const accessToken = decrypt(tokenRow.access_token_enc)
    const igClient = new InstagramClient(accessToken, account.platform_account_id, {
      apiBaseUrl: account.api_base_url ?? undefined,
      apiVersion: account.api_version ?? undefined,
    })
    const { data: profile } = await igClient.getProfileForSync(account.username)

    const profileData = profile as Record<string, unknown>
    const username =
      typeof profileData.username === 'string' && profileData.username.length > 0
        ? profileData.username
        : undefined

    const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined)
    const followersCount = num(profileData.followers_count)
    const followsCount = num(profileData.follows_count)
    const mediaCount = num(profileData.media_count)

    const pictureUrl =
      typeof profileData.profile_picture_url === 'string' && profileData.profile_picture_url.length > 0
        ? profileData.profile_picture_url
        : undefined

    await admin.from('ig_accounts').update({
      ...(username !== undefined ? { username } : {}),
      account_name: profileData.name as string | null,
      ...(pictureUrl !== undefined ? { profile_picture_url: pictureUrl } : {}),
      ...(followersCount !== undefined ? { followers_count: followersCount } : {}),
      ...(followsCount !== undefined ? { follows_count: followsCount } : {}),
      ...(mediaCount !== undefined ? { media_count: mediaCount } : {}),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    return NextResponse.json({ success: true, profile: profileData })
  } catch (err) {
    const useIgHost = useInstagramHostFromAccount(account.api_base_url)

    if (err instanceof InstagramApiError) {
      const metaMsg = typeof err.apiError?.message === 'string' ? err.apiError.message : err.message
      console.error('[sync] Instagram sync failed', {
        accountId: id,
        platformAccountIdSuffix: maskPlatformAccountId(account.platform_account_id),
        apiBaseUrl: account.api_base_url ?? null,
        apiVersion: account.api_version ?? null,
        useInstagramHost: useIgHost,
        httpStatus: err.status,
        metaCode: err.apiError?.code,
        metaType: err.apiError?.type,
        metaMessage: err.apiError?.message,
        fbtrace_id: err.apiError?.fbtrace_id,
        step: err.requestContext?.step,
        safeRequestUrl: err.requestContext?.safeUrl,
      })
      const payload: {
        error: string
        details?: Record<string, unknown>
      } = { error: metaMsg }
      if (includeSyncErrorDetailsInResponse()) {
        payload.details = {
          httpStatus: err.status,
          code: err.apiError?.code,
          type: err.apiError?.type,
          fbtrace_id: err.apiError?.fbtrace_id,
          step: err.requestContext?.step,
          safeRequestUrl: err.requestContext?.safeUrl,
        }
      }
      return NextResponse.json(payload, { status: 500 })
    }

    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[sync] error', {
      accountId: id,
      platformAccountIdSuffix: maskPlatformAccountId(account.platform_account_id),
      apiBaseUrl: account.api_base_url ?? null,
      useInstagramHost: useIgHost,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
