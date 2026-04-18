/**
 * Instagram フォロワー／いいね一覧などからコピーした HTML から、指定 class を持つ要素のテキストをユーザー名として抽出する。
 * ブラウザの DOMParser を使う（このモジュールはクライアントからのみ import すること）。
 */

/** ユーザー名表示に付くことが多い class（Instagram の DOM が変われば開発者ツールで取り直す） */
export const DEFAULT_IG_USERNAME_SPAN_CLASSES = '_ap3a _aaco _aacw _aacx _aad7 _aade'

const IG_USERNAME_RE = /^[a-z0-9._]{1,30}$/i

/** Node 等で `CSS.escape` が無いとき用（ブラウザではネイティブを優先） */
function escapeCssIdent(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    const cp = c.codePointAt(0)!
    if (cp === 0) {
      out += '\ufffd'
      continue
    }
    if ((cp >= 1 && cp <= 31) || cp === 127) {
      out += `\\${cp.toString(16)} `
      continue
    }
    if (/[0-9a-zA-Z_-]/.test(c)) {
      out += c
      continue
    }
    out += `\\${c}`
  }
  return out
}

/** スペース区切りの class 名（例: `_ap3a _aaco _aacw`）を querySelector 用セレクタに変換 */
export function buildClassSelector(classNames: string): string {
  const tokens = classNames.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) throw new Error('class が空です')
  return tokens.map((c) => `.${escapeCssIdent(c)}`).join('')
}

function normalizeUsername(text: string): string | null {
  const u = text.replace(/^@+/, '').trim().toLowerCase()
  if (!u || !IG_USERNAME_RE.test(u)) return null
  return u
}

/**
 * @param html 貼り付けた HTML 断片（document 全体でなくてよい）
 * @param classNames 対象要素の class（Instagram の開発者ツールで確認した値。スペース区切り）
 */
export function extractFollowerUsernamesFromHtml(html: string, classNames: string): string[] {
  const trimmed = html.trim()
  if (!trimmed) return []

  if (typeof DOMParser === 'undefined') {
    console.warn('[extractFollowerUsernamesFromHtml] DOMParser が使えません')
    return []
  }

  let selector: string
  try {
    selector = buildClassSelector(classNames)
  } catch {
    return []
  }

  const doc = new DOMParser().parseFromString(trimmed, 'text/html')
  let nodes: NodeListOf<Element>
  try {
    nodes = doc.querySelectorAll(selector)
  } catch {
    return []
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const el of nodes) {
    const raw = el.textContent ?? ''
    const u = normalizeUsername(raw)
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}
