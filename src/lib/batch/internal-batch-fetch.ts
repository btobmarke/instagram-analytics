/**
 * キューワーカーが Route Handler を同一プロセスで呼ぶときの Bearer ヘッダー。
 */
export function getBatchAuthHeader(): string | null {
  const t = process.env.CRON_SECRET || process.env.BATCH_SECRET
  if (!t) return null
  return `Bearer ${t}`
}
