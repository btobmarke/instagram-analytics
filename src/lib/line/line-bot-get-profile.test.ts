import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { lineBotGetProfile } from '@/lib/line/line-bot-api'

describe('lineBotGetProfile', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            userId: 'U123',
            displayName: 'Test User',
            pictureUrl: 'https://example.com/p.png',
            statusMessage: 'hello',
            language: 'ja',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed profile on 200', async () => {
    const r = await lineBotGetProfile('token', 'U123')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.profile.userId).toBe('U123')
      expect(r.profile.displayName).toBe('Test User')
      expect(r.profile.pictureUrl).toBe('https://example.com/p.png')
      expect(r.profile.statusMessage).toBe('hello')
      expect(r.profile.language).toBe('ja')
    }
  })
})
