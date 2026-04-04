/**
 * 数値を日本語表記でフォーマット（1000 → 1,000）
 */
export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('ja-JP')
}

/**
 * パーセント表記（0.045 → 4.5%）
 */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—'
  return `${value.toFixed(decimals)}%`
}

/**
 * 日時フォーマット（ISO → YYYY/MM/DD HH:mm）
 */
export function formatDatetime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 相対時間（5分前など）
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '未同期'
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  return `${days}日前`
}

/**
 * 達成率のステータスを返す
 */
export function getAchievementStatus(rate: number | null): 'achieved' | 'on_track' | 'warning' | 'critical' | 'insufficient_data' {
  if (rate == null) return 'insufficient_data'
  if (rate >= 100) return 'achieved'
  if (rate >= 70) return 'on_track'
  if (rate >= 40) return 'warning'
  return 'critical'
}

/**
 * 達成率のカラーを返す（Tailwind class）
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'achieved': return 'text-emerald-600'
    case 'on_track': return 'text-emerald-600'
    case 'warning': return 'text-amber-600'
    case 'critical': return 'text-red-600'
    default: return 'text-gray-400'
  }
}
