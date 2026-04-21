/**
 * User-Agent 文字列から端末カテゴリを推定（サーバー・クライアント共通）。
 * iPadOS の一部 UA は Macintosh 扱いになり得る（既知の限界）。
 */
export type LpDeviceCategory = 'mobile' | 'tablet' | 'desktop' | 'unknown'

export function parseDeviceCategoryFromUserAgent(
  userAgent: string | null | undefined,
): LpDeviceCategory {
  if (userAgent == null || typeof userAgent !== 'string') return 'unknown'
  const ua = userAgent.trim()
  if (!ua) return 'unknown'

  const s = ua.toLowerCase()

  if (/\b(ipad|tablet|playbook)\b/.test(s)) return 'tablet'
  if (/\bandroid\b/.test(s) && !/\bmobile\b/.test(s)) return 'tablet'
  if (/\bkindle\b|silk\//.test(s)) return 'tablet'

  if (/\b(iphone|ipod)\b/.test(s)) return 'mobile'
  if (/\bandroid\b.*\bmobile\b/.test(s)) return 'mobile'
  if (/\b(blackberry|bb10|windows phone|iemobile|webos|opera mini)\b/.test(s)) return 'mobile'

  if (
    /\b(windows nt|win64|wow64|macintosh|x11; linux|x11; ubuntu|linux x86_64|linux aarch64|cros\b)\b/.test(s)
  ) {
    return 'desktop'
  }

  return 'unknown'
}

/** 管理画面表示用の短い日本語ラベル */
export function formatDeviceCategoryJa(
  category: LpDeviceCategory | string | null | undefined,
): string {
  switch (category) {
    case 'mobile':
      return 'スマホ'
    case 'tablet':
      return 'タブレット'
    case 'desktop':
      return 'PC'
    default:
      return '不明'
  }
}
