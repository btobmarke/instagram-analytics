import { describe, expect, it } from 'vitest'
import { createHmac } from 'crypto'
import { verifyLineWebhookSignature } from './verify-webhook-signature'

describe('verifyLineWebhookSignature', () => {
  it('accepts valid LINE-style signature', () => {
    const secret = 'test_channel_secret'
    const body = '{"events":[]}'
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('base64')
    expect(verifyLineWebhookSignature(secret, body, sig)).toBe(true)
  })

  it('rejects wrong signature', () => {
    const secret = 'test_channel_secret'
    const body = '{"events":[]}'
    expect(verifyLineWebhookSignature(secret, body, 'invalid')).toBe(false)
  })

  it('rejects missing header', () => {
    expect(verifyLineWebhookSignature('s', '{}', null)).toBe(false)
  })
})
