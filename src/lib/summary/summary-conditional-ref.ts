/**
 * サマリ用「条件付き集計」仮想 fieldRef（fetchMetricsByRefs / rawData のキー）
 * 形式: summary@cond:v1:<base64url(JSON)>
 * JSON: { definitionId: string, ...params }
 */

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  const b64 =
    typeof btoa !== 'undefined'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4))
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(b64, 'base64'))
  }
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const PREFIX = 'summary@cond:v1:'

export function encodeSummaryConditionalRef(payload: {
  definitionId: string
} & Record<string, unknown>): string {
  const body = bytesToBase64Url(utf8Bytes(JSON.stringify(payload)))
  return `${PREFIX}${body}`
}

export function parseSummaryConditionalRef(ref: string): {
  definitionId: string
  params: Record<string, unknown>
} | null {
  if (!ref.startsWith(PREFIX)) return null
  const body = ref.slice(PREFIX.length)
  try {
    const raw = new TextDecoder().decode(base64UrlToBytes(body))
    const o = JSON.parse(raw) as { definitionId?: string } & Record<string, unknown>
    if (!o.definitionId || typeof o.definitionId !== 'string') return null
    const { definitionId, ...params } = o
    return { definitionId, params }
  } catch {
    return null
  }
}

export function isSummaryConditionalRef(ref: string): boolean {
  return ref.startsWith(PREFIX)
}
