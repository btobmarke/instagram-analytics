#!/usr/bin/env node
/**
 * insight-collector を 1 回実行し、結果を分類して終了コードで返す。
 *
 * 環境変数:
 *   BATCH_SMOKE_BASE_URL … 省略時 http://127.0.0.1:3000
 *   CRON_SECRET または BATCH_SECRET … 必須
 *   BATCH_SMOKE_NOTIFY_URL … 任意（JSON POST）
 *
 * 終了コード: 0 成功 / 2 認証・トークン / 3 レート制限 / 4 一時 / 5 partial / 6 その他
 */
const BASE = (process.env.BATCH_SMOKE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const SECRET = process.env.CRON_SECRET ?? process.env.BATCH_SECRET ?? ''
const NOTIFY_URL = process.env.BATCH_SMOKE_NOTIFY_URL ?? ''

function classify(bodyText, status) {
  const lower = (bodyText ?? '').toLowerCase()
  if (status === 401) return { code: 2, category: 'auth', message: '認証に失敗しました（401）。CRON_SECRET を確認してください。コード修正は不要です。' }
  if (status === 429) return { code: 3, category: 'rate_limit', message: 'レート制限の可能性（429）。再実行してください。コード修正は不要です。' }
  if (/\b(rate limit|usage limit|too many requests|#4)\b/i.test(bodyText) || /app.?usage/i.test(lower)) {
    return { code: 3, category: 'rate_limit', message: 'レート制限の記述があります。コード修正は不要です。' }
  }
  if (status === 502 || status === 503 || status === 504) {
    return { code: 4, category: 'transient', message: `一時エラー（${status}）。再実行してください。コード修正は不要です。` }
  }
  if (/invalid.?oauth|access.?token|expired|session has been invalidated/i.test(bodyText)) {
    return { code: 2, category: 'token', message: 'トークン無効の可能性。連携を更新してください。コード修正は不要です。' }
  }
  return null
}

async function notify(payload) {
  if (!NOTIFY_URL) return
  try {
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    console.warn('[batch-smoke] NOTIFY_URL 失敗:', e instanceof Error ? e.message : String(e))
  }
}

async function main() {
  if (!SECRET) {
    const msg = 'CRON_SECRET または BATCH_SECRET が未設定です。'
    console.error('[batch-smoke]', msg)
    await notify({ text: msg, category: 'config', exitCode: 2 })
    process.exit(2)
  }

  const url = `${BASE}/api/batch/insight-collector`
  let status = 0
  let bodyText = ''
  let json = null

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    status = res.status
    bodyText = await res.text()
    try {
      json = JSON.parse(bodyText)
    } catch {
      json = null
    }
  } catch (e) {
    const msg = `接続失敗: ${e instanceof Error ? e.message : String(e)}`
    console.error('[batch-smoke]', msg)
    await notify({ text: msg, category: 'network', exitCode: 4 })
    process.exit(4)
  }

  const early = classify(bodyText, status)
  if (early) {
    console.error('[batch-smoke]', `[${early.category}]`, early.message)
    await notify({ ...early, httpStatus: status, bodyPreview: bodyText.slice(0, 1500) })
    process.exit(early.code)
  }

  if (status === 200 && json && json.success === true) {
    console.log('[batch-smoke] OK', JSON.stringify(json))
    await notify({ text: 'insight-collector 成功', category: 'success', exitCode: 0, detail: json })
    process.exit(0)
  }

  if (status === 200 && json && json.success === false) {
    const msg = 'success=false（一部失敗）。ログ確認。自動修正はしない。'
    console.error('[batch-smoke]', msg, json)
    await notify({ text: msg, category: 'partial', exitCode: 5, detail: json })
    process.exit(5)
  }

  const again = classify(bodyText, status)
  if (again) {
    console.error('[batch-smoke]', again.message)
    await notify({ ...again, httpStatus: status })
    process.exit(again.code)
  }

  console.error('[batch-smoke] HTTP', status, bodyText.slice(0, 4000))
  await notify({ text: `HTTP ${status}`, category: 'unknown', exitCode: 6, bodyPreview: bodyText.slice(0, 2000) })
  process.exit(6)
}

main()
