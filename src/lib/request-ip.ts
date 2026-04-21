/**
 * リバースプロキシ経由のクライアント IP を推定する。
 * 先頭の X-Forwarded-For を採用（多くの環境で実クライアントが先頭）。
 */
export function getClientIpFromRequest(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const cf = request.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  return null
}
