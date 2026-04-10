import { GOOGLE_ADS_API_BASE } from './constants'

function truncateForLog(text: string, headChars: number, tailChars: number): string {
  if (text.length <= headChars + tailChars + 40) return text
  return `${text.slice(0, headChars)}\n... [truncated ${text.length - headChars - tailChars} chars] ...\n${text.slice(-tailChars)}`
}

function normalizeCustomerId(id: string): string {
  return id.replace(/-/g, '').trim()
}

/**
 * SearchStream の REST レスポンスは「トップレベルが JSON 配列」で各要素に results がある形式が公式。
 * @see https://developers.google.com/google-ads/api/rest/common/search
 * 旧実装は 1 行 1 JSON かつ { results } 前提で、配列ラップだと常に空になっていた。
 */
function extractRowsFromSearchStreamPayload(value: unknown): Record<string, unknown>[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractRowsFromSearchStreamPayload(item))
  }
  if (typeof value === 'object' && value !== null && 'results' in value) {
    const r = (value as { results?: unknown }).results
    if (Array.isArray(r)) return r as Record<string, unknown>[]
  }
  return []
}

function parseSearchStreamResults(text: string): Record<string, unknown>[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  try {
    return extractRowsFromSearchStreamPayload(JSON.parse(trimmed))
  } catch {
    // フォールバック: JSON Lines（1 行 1 オブジェクト）形式
    return trimmed.split('\n').flatMap((line) => {
      const t = line.trim()
      if (!t) return []
      try {
        return extractRowsFromSearchStreamPayload(JSON.parse(t))
      } catch {
        return []
      }
    })
  }
}

/** 403 の「login-customer-id / 管理アカウントと子の関係」系のみ再試行する */
function isLoginContextPermissionError(body: string): boolean {
  if (!body.includes('USER_PERMISSION_DENIED')) return false
  return (
    body.includes('login-customer-id') ||
    body.includes("manager's customer id") ||
    body.includes('manager\u2019s customer id')
  )
}

async function searchStreamOnce(params: {
  accessToken: string
  developerToken: string
  loginCustomerId: string
  customerAccountId: string
  query: string
}): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(
    `${GOOGLE_ADS_API_BASE}/customers/${params.customerAccountId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'developer-token': params.developerToken,
        'login-customer-id': normalizeCustomerId(params.loginCustomerId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: params.query }),
    }
  )
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

/**
 * Google Ads searchStream。
 * - 通常: login-customer-id = 管理アカウント（MCC）の顧客ID、URL 側 = 取得先の子アカウント。
 * - スタンドアロン（MCC なし）や MCC 欄の誤入力時: まず MCC を送り、403 USER_PERMISSION_DENIED のときだけ
 *   login-customer-id = 取得先 customer と同じIDで1回だけ再試行する（公式: Call structure / cid）。
 */
export async function searchStream(params: {
  accessToken: string
  developerToken: string
  managerCustomerId: string
  customerAccountId: string
  query: string
  /** ログ用ラベル（campaign / ad_group / keyword など） */
  debugLabel?: string
}): Promise<Record<string, unknown>[]> {
  const normManager = normalizeCustomerId(params.managerCustomerId)
  const normTarget = normalizeCustomerId(params.customerAccountId)
  const label = params.debugLabel ?? 'searchStream'

  let usedLoginCustomer = 'manager'
  let { ok, status, text } = await searchStreamOnce({
    accessToken: params.accessToken,
    developerToken: params.developerToken,
    loginCustomerId: params.managerCustomerId,
    customerAccountId: params.customerAccountId,
    query: params.query,
  })

  if (
    !ok &&
    status === 403 &&
    normManager !== normTarget &&
    isLoginContextPermissionError(text)
  ) {
    usedLoginCustomer = 'customer_retry'
    const second = await searchStreamOnce({
      accessToken: params.accessToken,
      developerToken: params.developerToken,
      loginCustomerId: params.customerAccountId,
      customerAccountId: params.customerAccountId,
      query: params.query,
    })
    ok = second.ok
    status = second.status
    text = second.text
  }

  if (!ok) {
    console.error('[google-ads searchStream] HTTP error', {
      label,
      customerId: params.customerAccountId,
      usedLoginCustomer,
      status,
      bodyLength: text.length,
      body: truncateForLog(text, 2500, 1500),
    })
    const err = new Error(`Google Ads API error: ${status} ${text}`)
    ;(err as Error & { isAuthError?: boolean }).isAuthError =
      status === 401 || status === 403
    throw err
  }

  const rows = parseSearchStreamResults(text)

  console.info('[google-ads searchStream] response', {
    label,
    customerId: params.customerAccountId,
    usedLoginCustomer,
    httpStatus: status,
    bodyLength: text.length,
    bodyPreview: truncateForLog(text, 4000, 2000),
    parsedRowCount: rows.length,
    firstRowTopLevelKeys: rows[0] ? Object.keys(rows[0]) : [],
    firstRowSample: rows[0] ? JSON.stringify(rows[0]).slice(0, 800) : null,
  })

  if (rows.length === 0 && text.trim().length > 0) {
    try {
      const j: unknown = JSON.parse(text.trim())
      const top = j as Record<string, unknown> | unknown[]
      console.warn('[google-ads searchStream] parsed 0 rows but body non-empty — structure hint', {
        label,
        topIsArray: Array.isArray(j),
        topArrayLength: Array.isArray(j) ? j.length : null,
        topKeys: j && typeof j === 'object' && !Array.isArray(j) ? Object.keys(j as object) : null,
        firstElementKeys:
          Array.isArray(j) && j[0] && typeof j[0] === 'object'
            ? Object.keys(j[0] as object)
            : null,
      })
    } catch (e) {
      console.warn('[google-ads searchStream] body is not single JSON; line-fallback may apply', {
        label,
        parseError: e instanceof Error ? e.message : String(e),
        firstLines: text.trim().split('\n').slice(0, 3).map((l) => l.slice(0, 200)),
      })
    }
  }

  return rows
}
