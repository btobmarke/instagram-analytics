/**
 * バッチAPIの認証ヘルパー
 * Authorization: Bearer <token> を検証。
 * token は CRON_SECRET または BATCH_SECRET のいずれかと一致すれば可（後方互換）。
 */
export function validateBatchRequest(request: Request): boolean {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return false

  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  const token = (m ? m[1] : authHeader.replace(/^Bearer\s+/i, '')).trim()
  if (!token) return false

  const cronSecret = process.env.CRON_SECRET
  const batchSecret = process.env.BATCH_SECRET
  if (cronSecret && token === cronSecret) return true
  if (batchSecret && token === batchSecret) return true
  return false
}

/** 401 調査用。シークレット値は出さない */
export function logBatchAuthFailure(route: string, request: Request): void {
  const hasHeader = !!request.headers.get('authorization')
  const hasCron = Boolean(process.env.CRON_SECRET?.length)
  const hasBatch = Boolean(process.env.BATCH_SECRET?.length)
  console.warn(`[batch-auth] ${route} 401`, {
    hasAuthorizationHeader: hasHeader,
    hasCRON_SECRET_env: hasCron,
    hasBATCH_SECRET_env: hasBatch,
    hint:
      !hasCron && !hasBatch
        ? 'CRON_SECRET または BATCH_SECRET をサーバー環境に設定してください'
        : !hasHeader
          ? 'Authorization: Bearer <...> がありません'
          : 'ヘッダーのトークンが CRON_SECRET / BATCH_SECRET のいずれとも一致しません',
  })
}
