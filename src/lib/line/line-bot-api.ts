/**
 * LINE Messaging / Data API の汎用呼び出し（Rich Menu 画像アップロード等）
 */

const LINE_BOT_API = 'https://api.line.me/v2/bot'
const LINE_DATA_API = 'https://api-data.line.me/v2/bot'

export type LineApiResult =
  | { ok: true; status: number; body?: unknown; requestId?: string | null }
  | { ok: false; status: number; message: string; requestId?: string | null }

function parseErr(text: string): string {
  try {
    const j = JSON.parse(text) as { message?: string }
    return j.message ?? text
  } catch {
    return text.slice(0, 500)
  }
}

export async function lineBotRequestJson(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  accessToken: string,
  body?: unknown,
  baseUrl: string = LINE_BOT_API,
): Promise<LineApiResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const requestId = res.headers.get('x-line-request-id')
  const text = await res.text()
  if (res.ok) {
    if (!text) return { ok: true, status: res.status, requestId }
    try {
      return { ok: true, status: res.status, body: JSON.parse(text), requestId }
    } catch {
      return { ok: true, status: res.status, requestId }
    }
  }
  return { ok: false, status: res.status, message: parseErr(text), requestId }
}

export async function lineDataUploadRichMenuImage(
  accessToken: string,
  richMenuId: string,
  imageBytes: Buffer,
  contentType: 'image/jpeg' | 'image/png',
): Promise<LineApiResult> {
  const path = `/richmenu/${richMenuId}/content`
  const res = await fetch(`${LINE_DATA_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Authorization: `Bearer ${accessToken}`,
    },
    body: new Uint8Array(imageBytes),
  })
  const requestId = res.headers.get('x-line-request-id')
  const text = await res.text()
  if (res.ok) {
    return { ok: true, status: res.status, requestId }
  }
  return { ok: false, status: res.status, message: parseErr(text) || text, requestId }
}

export async function lineBotLinkRichMenuToUser(
  accessToken: string,
  lineUserId: string,
  richMenuId: string,
): Promise<LineApiResult> {
  return lineBotRequestJson(
    'POST',
    `/user/${encodeURIComponent(lineUserId)}/richmenu/${encodeURIComponent(richMenuId)}`,
    accessToken,
    undefined,
  )
}
