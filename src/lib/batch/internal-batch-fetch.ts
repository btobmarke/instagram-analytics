/**
 * サーバー間でバッチ API を呼ぶ（キューワーカー・Cron オーケストレータ用）
 */
export function getBatchDeploymentOrigin(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (explicit) return explicit
  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`
  return null
}

export function getBatchAuthHeader(): string | null {
  const t = process.env.CRON_SECRET || process.env.BATCH_SECRET
  if (!t) return null
  return `Bearer ${t}`
}

export type BatchProxyPayload = {
  path: string
  method?: 'GET' | 'POST'
  /** クエリオブジェクト（例: { date: "2025-01-01" }） */
  query?: Record<string, string | undefined>
  /** JSON ボディ（POST 時） */
  body?: Record<string, unknown>
}

export function buildInternalBatchUrl(
  origin: string,
  path: string,
  query?: Record<string, string | undefined>
): string {
  const base = origin.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  const u = new URL(`${base}${p}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') u.searchParams.set(k, v)
    }
  }
  return u.toString()
}

/**
 * 同一オリジンへバッチを実行。失敗時は Response をそのまま返す想定。
 */
export async function forwardBatchRequest(
  origin: string,
  authHeader: string,
  payload: BatchProxyPayload
): Promise<Response> {
  const method = payload.method ?? 'POST'
  const url = buildInternalBatchUrl(origin, payload.path, payload.query)

  const headers: Record<string, string> = {
    Authorization: authHeader,
  }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
  }

  const timeoutMs = Math.min(
    290_000,
    Math.max(30_000, parseInt(process.env.BATCH_PROXY_FETCH_TIMEOUT_MS ?? '240000', 10) || 240_000)
  )
  const signal = AbortSignal.timeout(timeoutMs)

  return fetch(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(payload.body ?? {}) : undefined,
    signal,
  })
}
