/**
 * バッチ通知ユーティリティ（正常終了・エラー）
 *
 * 環境変数がセットされているチャンネルにのみ通知します。
 * セットされていないチャンネルは自動でスキップ（エラーにはなりません）。
 *
 * 対応チャンネル:
 *   - メール (SMTP / Gmail 等) : SMTP_HOST + SMTP_USER + SMTP_PASS + NOTIFY_EMAIL_TO
 *   - メール (Resend)          : RESEND_API_KEY + NOTIFY_EMAIL_TO（SMTP 未設定時のみ）
 *   - LINE Messaging API      : LINE_CHANNEL_ACCESS_TOKEN + LINE_NOTIFY_USER_ID
 *   - Teams Incoming Webhook  : TEAMS_WEBHOOK_URL
 */

import nodemailer from 'nodemailer'

export interface BatchNotifyPayload {
  /** バッチ名（例: 'line_oam_daily'）*/
  jobName: string
  /** 処理成功件数 */
  processed: number
  /** エラー件数 */
  errorCount: number
  /** エラー詳細（最大5件まで表示） */
  errors: Array<{ serviceId?: string; clientId?: string; error: string }>
  /** バッチ実行時刻（省略時は現在時刻） */
  executedAt?: Date
}

export interface BatchSuccessPayload {
  jobName: string
  /** 処理した件数（サービス数・サイト数などジョブに応じた意味） */
  processed: number
  executedAt?: Date
  /** 本文に追加する行（対象日・補足メトリクスなど） */
  lines?: string[]
}

// ----------------------------------------------------------------
// メイン: 全チャンネルへ並列送信
// ----------------------------------------------------------------

export async function notifyBatchError(payload: BatchNotifyPayload): Promise<void> {
  const results = await Promise.allSettled([
    sendErrorEmail(payload),
    sendErrorLine(payload),
    sendErrorTeams(payload),
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[batch-notify] 通知送信に失敗しました:', result.reason)
    }
  }
}

export async function notifyBatchSuccess(payload: BatchSuccessPayload): Promise<void> {
  const results = await Promise.allSettled([
    sendSuccessEmail(payload),
    sendSuccessLine(payload),
    sendSuccessTeams(payload),
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[batch-notify] 正常終了通知の送信に失敗しました:', result.reason)
    }
  }
}

// ----------------------------------------------------------------
// 共通: メッセージ組み立て
// ----------------------------------------------------------------

function buildSummary(payload: BatchNotifyPayload): { title: string; body: string } {
  const at = (payload.executedAt ?? new Date()).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const title = `⚠️ バッチエラー検出: ${payload.jobName}`
  const topErrors = payload.errors.slice(0, 5)
  const errorLines = topErrors
    .map(e => {
      const id = e.serviceId ?? e.clientId ?? '—'
      return `  • [${id}] ${e.error}`
    })
    .join('\n')
  const more = payload.errors.length > 5 ? `\n  ...他 ${payload.errors.length - 5} 件` : ''

  const body = [
    `ジョブ名 : ${payload.jobName}`,
    `実行日時 : ${at}`,
    `処理成功 : ${payload.processed} 件`,
    `エラー数 : ${payload.errorCount} 件`,
    '',
    'エラー詳細:',
    errorLines + more,
  ].join('\n')

  return { title, body }
}

function buildSuccessSummary(payload: BatchSuccessPayload): { title: string; body: string } {
  const at = (payload.executedAt ?? new Date()).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const title = `✅ バッチ正常終了: ${payload.jobName}`
  const base = [
    `ジョブ名 : ${payload.jobName}`,
    `実行日時 : ${at}`,
    `処理件数 : ${payload.processed} 件`,
  ]
  const extra = payload.lines?.length
    ? ['', ...payload.lines]
    : []
  const body = [...base, ...extra].join('\n')
  return { title, body }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.NOTIFY_EMAIL_TO
  )
}

// ----------------------------------------------------------------
// メール: 本文共通配送
// ----------------------------------------------------------------

async function deliverEmail(title: string, body: string): Promise<void> {
  if (isSmtpConfigured()) {
    return deliverSmtp(title, body)
  }
  return deliverResend(title, body)
}

async function deliverSmtp(title: string, body: string): Promise<void> {
  const host = process.env.SMTP_HOST!
  const user = process.env.SMTP_USER!
  const pass = process.env.SMTP_PASS!
  const to = process.env.NOTIFY_EMAIL_TO!

  const portRaw = process.env.SMTP_PORT
  const port = portRaw ? parseInt(portRaw, 10) : 465
  if (Number.isNaN(port)) {
    throw new Error('[batch-notify] SMTP_PORT が不正です')
  }

  let secure: boolean
  if (process.env.SMTP_SECURE === 'true') secure = true
  else if (process.env.SMTP_SECURE === 'false') secure = false
  else secure = port === 465

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  })

  const from = process.env.NOTIFY_EMAIL_FROM ?? user
  const htmlBody = escapeHtml(body)

  await transporter.sendMail({
    from,
    to: to.split(',').map(s => s.trim()),
    subject: title,
    text: body,
    html: `<pre style="font-family:sans-serif;font-size:14px;line-height:1.6">${htmlBody}</pre>`,
  })
}

async function deliverResend(title: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const to     = process.env.NOTIFY_EMAIL_TO

  if (!apiKey || !to) return

  const from = process.env.NOTIFY_EMAIL_FROM ?? 'noreply@resend.dev'
  const htmlBody = escapeHtml(body)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: to.split(',').map(s => s.trim()),
      subject: title,
      html: `<pre style="font-family:sans-serif;font-size:14px;line-height:1.6">${htmlBody}</pre>`,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Resend API error ${res.status}: ${text}`)
  }
}

async function sendErrorEmail(payload: BatchNotifyPayload): Promise<void> {
  const { title, body } = buildSummary(payload)
  return deliverEmail(title, body)
}

async function sendSuccessEmail(payload: BatchSuccessPayload): Promise<void> {
  const { title, body } = buildSuccessSummary(payload)
  return deliverEmail(title, body)
}

// ----------------------------------------------------------------
// LINE
// ----------------------------------------------------------------

async function deliverLine(title: string, body: string): Promise<void> {
  const token  = process.env.LINE_CHANNEL_ACCESS_TOKEN
  const userId = process.env.LINE_NOTIFY_USER_ID

  if (!token || !userId) return

  const text = `${title}\n\n${body}`

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  })

  if (!res.ok) {
    const text2 = await res.text()
    throw new Error(`LINE Messaging API error ${res.status}: ${text2}`)
  }
}

async function sendErrorLine(payload: BatchNotifyPayload): Promise<void> {
  const { title, body } = buildSummary(payload)
  return deliverLine(title, body)
}

async function sendSuccessLine(payload: BatchSuccessPayload): Promise<void> {
  const { title, body } = buildSuccessSummary(payload)
  return deliverLine(title, body)
}

// ----------------------------------------------------------------
// Teams
// ----------------------------------------------------------------

async function sendErrorTeams(payload: BatchNotifyPayload): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL
  if (!webhookUrl) return

  const { title, body } = buildSummary(payload)
  const at = (payload.executedAt ?? new Date()).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: title,
              weight: 'Bolder',
              size: 'Medium',
              color: 'Warning',
              wrap: true,
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'ジョブ名',   value: payload.jobName },
                { title: '実行日時',   value: at },
                { title: '処理成功',   value: `${payload.processed} 件` },
                { title: 'エラー数',   value: `${payload.errorCount} 件` },
              ],
            },
            {
              type: 'TextBlock',
              text: 'エラー詳細',
              weight: 'Bolder',
              spacing: 'Medium',
            },
            {
              type: 'TextBlock',
              text: body.split('\n').slice(6).join('\n'),
              wrap: true,
              fontType: 'Monospace',
            },
          ],
        },
      },
    ],
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Teams Webhook error ${res.status}: ${text}`)
  }
}

async function sendSuccessTeams(payload: BatchSuccessPayload): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL
  if (!webhookUrl) return

  const at = (payload.executedAt ?? new Date()).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const title = `✅ バッチ正常終了: ${payload.jobName}`

  const bodyBlocks: unknown[] = [
    {
      type: 'TextBlock',
      text: title,
      weight: 'Bolder',
      size: 'Medium',
      color: 'Good',
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'ジョブ名', value: payload.jobName },
        { title: '実行日時', value: at },
        { title: '処理件数', value: `${payload.processed} 件` },
      ],
    },
  ]

  if (payload.lines?.length) {
    bodyBlocks.push(
      {
        type: 'TextBlock',
        text: '補足',
        weight: 'Bolder',
        spacing: 'Medium',
      },
      {
        type: 'TextBlock',
        text: payload.lines.join('\n'),
        wrap: true,
        fontType: 'Monospace',
      }
    )
  }

  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: bodyBlocks,
        },
      },
    ],
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Teams Webhook error ${res.status}: ${text}`)
  }
}
