import { createHmac, timingSafeEqual } from 'crypto'

/**
 * LINE Messaging API Webhook の x-line-signature 検証（HMAC-SHA256 + Base64）
 */
export function verifyLineWebhookSignature(
  channelSecret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader || !channelSecret) return false
  const digest = createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest('base64')
  try {
    const a = Buffer.from(digest, 'utf8')
    const b = Buffer.from(signatureHeader, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
