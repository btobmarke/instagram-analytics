/**
 * 実 API に触れる任意テスト。秘密情報はコミットしないこと。
 *
 * 実行例（.env.local に載せた値をシェルで渡す）:
 *   GA4_SERVICE_ACCOUNT_JSON="$(cat path/to/sa.json)" GA4_PROPERTY_ID=123456789 npm run test -- src/lib/ga4/ga4-client.live.test.ts
 *
 * 環境変数が無い場合はスキップされる。
 */
import { describe, expect, it } from 'vitest'
import { fetchDailySummary, getAccessToken, parseServiceAccount } from '@/lib/ga4/client'

const saJson = process.env.GA4_SERVICE_ACCOUNT_JSON
const propertyId = process.env.GA4_PROPERTY_ID
const live = Boolean(saJson && propertyId)

describe('GA4 live API (optional)', () => {
  it.skipIf(!live)('fetchDailySummary がエラーなく完了する', async () => {
    const sa = parseServiceAccount(saJson!)
    const token = await getAccessToken(sa)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const rows = await fetchDailySummary(propertyId!, token, yesterday)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]!.metrics.length).toBe(12)
  })
})
