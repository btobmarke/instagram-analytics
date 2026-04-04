/**
 * バッチAPIの認証ヘルパー
 * Authorization: Bearer <CRON_SECRET> ヘッダーを検証
 */
export function validateBatchRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authHeader = request.headers.get('authorization')
  if (!authHeader) return false

  const token = authHeader.replace('Bearer ', '')
  return token === cronSecret
}
