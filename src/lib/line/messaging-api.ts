/**
 * LINE Messaging API の薄いラッパ（push / multicast / reply）
 * @see https://developers.line.biz/en/reference/messaging-api/
 */

const LINE_BOT_API = 'https://api.line.me/v2/bot'

export type LineTextMessage = { type: 'text'; text: string }

export type LineMessagingResult =
  | { ok: true; requestId?: string | null }
  | { ok: false; status: number; message: string; requestId?: string | null }

function parseErrorMessage(text: string): string {
  try {
    const j = JSON.parse(text) as { message?: string }
    return j.message ?? text
  } catch {
    return text.slice(0, 500)
  }
}

async function lineMessagingFetch(
  path: string,
  accessToken: string,
  body: unknown,
): Promise<LineMessagingResult> {
  const res = await fetch(`${LINE_BOT_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  const requestId = res.headers.get('x-line-request-id')
  if (res.ok) {
    return { ok: true, requestId }
  }
  const errText = await res.text()
  return {
    ok: false,
    status: res.status,
    message: parseErrorMessage(errText),
    requestId,
  }
}

/** 1 ユーザーへ最大 5 件まで（LINE 仕様） */
export function lineMessagingPush(
  channelAccessToken: string,
  to: string,
  messages: LineTextMessage[],
): Promise<LineMessagingResult> {
  return lineMessagingFetch('/message/push', channelAccessToken, { to, messages })
}

/** 最大 500 ユーザー（LINE 仕様）。messages は最大 5 件 */
export function lineMessagingMulticast(
  channelAccessToken: string,
  to: string[],
  messages: LineTextMessage[],
): Promise<LineMessagingResult> {
  return lineMessagingFetch('/message/multicast', channelAccessToken, { to, messages })
}

/** Webhook の replyToken で返信（トークンは一度限り） */
export function lineMessagingReply(
  channelAccessToken: string,
  replyToken: string,
  messages: LineTextMessage[],
): Promise<LineMessagingResult> {
  return lineMessagingFetch('/message/reply', channelAccessToken, { replyToken, messages })
}
