#!/usr/bin/env node
/**
 * insight-collector を 1 回実行し、結果を分類して終了コードで返す。
 *
 * 環境変数:
 *   BATCH_SMOKE_BASE_URL … 省略時 http://127.0.0.1:3000（末尾スラッシュなし）
 *   CRON_SECRET または BATCH_SECRET … 必須（Authorization: Bearer）
 *   BATCH_SMOKE_NOTIFY_URL … 任意。POST で JSON { text, category, exitCode, ... } を送る（Slack Incoming Webhook 等）
 *
 * 終了コード:
 *   0 … 成功（HTTP 200 かつ JSON success === true）
 *   2 … 認証失敗（401 / CRON_SECRET 不一致）→ コード修正不要、トークン・環境変数を確認
 *   3 … レート制限の疑い（429 または本文に rate limit 等）→ 修正不要、時間をおいて再実行
 *   4 … 一時エラー（502/503/504、ネットワーク失敗）→ 修正不要、再実行
 *   5 … 部分成功（200 だが success === false）→ 要確認（Instagram API 個別失敗など）。自動修正はしない
 *   6 … その他の失敗（500 等）→ 要調査。一時的でなければコード・ログ確認
 */

const BASE = (process.env.BATCH_SMOKE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const SECRET = process.env.CRON_SECRET ?? process.env.BATCH_SECRET ?? ''
const NOTIFY_URL = process.env.BATCH_SMOKE_NOTIFY_URL ?? ''

function classify(bodyText, status) {
  const lower = (bodyText ?? '').toLowerCase()
  if (status === 401) {
    return {
      code: 2,
      category: 'auth',
      message:
        '認証に失敗しました（401）。CRON_SECRET / BATCH_SECRET とサーバー設定を確認してください。コード修正は不要です。',
    }
  }
  if (status === 429) {
    return {
      code: 3,
      category: 'rate_limit',
      message: 'レート制限の可能性があります（429）。しばらく待って再実行してください。コード修正は不要です。',
    }
  }
  if (/\b(rate limit|usage limit|too many requests|#4)\b/i.test(bodyText) || /app.?usage/i.test(lower)) {
    return {
      code: 3,
      category: 'rate_limit',
      message: 'レスポンスにレート制限の記述があります。時間をおいて再実行してください。コード修正は不要です。',
    }
  }
  if (status === 502 || status === 503 || status === 504) {
    return {
      code: 4,
      category: 'transient',
      message: `一時的なサーバーエラー（${status}）です。再実行してください。コード修正は不要です。`,
    }
  }
  if (/invalid.?oauth|access.?token|expired|session has been invalidated/i.test(bodyText)) {
    return {
      code: 2,
      category: 'token',
      message:
        'トークン無効・期限切れの可能性があります。Instagram 連携トークンを更新してください。コード修正は不要です。',
    }
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
    console.warn('[batch-smoke] NOTIFY_URL への送信に失敗:', e instanceof Error ? e.message : String(e))
  }
}

async function main() {
  if (!SECRET) {
    const msg =
      'CRON_SECRET または BATCH_SECRET が未設定です。コード修正は不要です。環境変数を設定してください。'
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
    const msg = `接続に失敗しました（${e instanceof Error ? e.message : String(e)}）。サーバー起動やネットワークを確認してください。コード修正は不要な場合があります。`
    console.error('[batch-smoke]', msg)
    await notify({ text: msg, category: 'network', exitCode: 4, error: String(e) })
    process.exit(4)
  }

  const early = classify(bodyText, status)
  if (early) {
    console.error('[batch-smoke]', `[${early.category}]`, early.message)
    console.error('[batch-smoke] HTTP', status, bodyText.slice(0, 2000))
    await notify({ ...early, httpStatus: status, bodyPreview: bodyText.slice(0, 1500) })
    process.exit(early.code)
  }

  if (status === 200 && json && json.success === true) {
    console.log('[batch-smoke] OK', JSON.stringify(json, null, 0))
    await notify({ text: 'insight-collector が成功しました。', category: 'success', exitCode: 0, detail: json })
    process.exit(0)
  }

  if (status === 200 && json && json.success === false) {
    const msg =
      'insight-collector は完了しましたが success=false です（一部メディア/API 失敗）。ログと failed 件数を確認してください。レート制限・トークンでない限りコード調査の対象になり得ます。自動修正は行いません。'
    console.error('[batch-smoke] [partial]', msg)
    console.error('[batch-smoke]', JSON.stringify(json, null, 2))
    await notify({ text: msg, category: 'partial', exitCode: 5, detail: json })
    process.exit(5)
  }

  const again = classify(bodyText, status)
  if (again) {
    console.error('[batch-smoke]', `[${again.category}]`, again.message)
    await notify({ ...again, httpStatus: status, bodyPreview: bodyText.slice(0, 1500) })
    process.exit(again.code)
  }

  const msg = `想定外の応答です（HTTP ${status}）。レスポンスを確認してください。`
  console.error('[batch-smoke]', msg)
  console.error(bodyText.slice(0, 4000))
  await notify({ text: msg, category: 'unknown', exitCode: 6, httpStatus: status, bodyPreview: bodyText.slice(0, 2000) })
  process.exit(6)
}

main()
