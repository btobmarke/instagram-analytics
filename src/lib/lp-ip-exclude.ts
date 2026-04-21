/**
 * LP 公開 API 用: IPv4 アドレスが CIDR 一覧のいずれかに含まれるか。
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function ipv4ToUint(ip: string): number | null {
  const m = ip.trim().match(IPV4_RE)
  if (!m) return null
  const octets = [m[1], m[2], m[3], m[4]].map((x) => parseInt(x, 10))
  for (const o of octets) {
    if (o < 0 || o > 255) return null
  }
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0)
}

/** @returns 正規化済み CIDR 文字列、または null */
export function parseIpv4Cidr(input: string): { normalized: string; network: number; mask: number } | null {
  const s = input.trim()
  if (!s) return null

  const slash = s.indexOf('/')
  const addrPart = slash >= 0 ? s.slice(0, slash).trim() : s
  const prefixPart = slash >= 0 ? s.slice(slash + 1).trim() : '32'

  const ipInt = ipv4ToUint(addrPart)
  if (ipInt === null) return null

  const prefix = parseInt(prefixPart, 10)
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return null

  const mask = prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0
  const network = (ipInt & mask) >>> 0

  const a = (network >>> 24) & 255
  const b = (network >>> 16) & 255
  const c = (network >>> 8) & 255
  const d = network & 255
  const normalized = `${a}.${b}.${c}.${d}/${prefix}`

  return { normalized, network, mask }
}

export function ipv4MatchesAnyCidr(ip: string, cidrs: unknown): boolean {
  if (!Array.isArray(cidrs) || cidrs.length === 0) return false

  const ipInt = ipv4ToUint(ip)
  if (ipInt === null) return false

  for (const raw of cidrs) {
    if (typeof raw !== 'string') continue
    const parsed = parseIpv4Cidr(raw)
    if (!parsed) continue
    if ((ipInt & parsed.mask) >>> 0 === parsed.network) return true
  }
  return false
}

/** API 入力 → 正規化・重複除去・最大件数（DB 負荷防止） */
export function normalizeLpMaIpExcludeList(
  raw: unknown,
  opts?: { maxEntries?: number }
): { ok: true; cidrs: string[] } | { ok: false; message: string } {
  const maxEntries = opts?.maxEntries ?? 50

  if (!Array.isArray(raw)) {
    return { ok: false, message: 'lp_ma_ip_exclude_cidr は文字列の配列である必要があります' }
  }
  if (raw.length > maxEntries) {
    return { ok: false, message: `除外 CIDR は最大 ${maxEntries} 件までです` }
  }

  const normalized = new Set<string>()
  const parsedList: { normalized: string; network: number; prefix: number }[] = []
  for (const item of raw) {
    if (typeof item !== 'string') {
      return { ok: false, message: '除外 CIDR の各要素は文字列である必要があります' }
    }
    const parsed = parseIpv4Cidr(item)
    if (!parsed) {
      return { ok: false, message: `無効な CIDR です: ${item}` }
    }
    if (normalized.has(parsed.normalized)) continue
    normalized.add(parsed.normalized)
    const prefix = parseInt(parsed.normalized.split('/')[1] ?? '32', 10)
    parsedList.push({ normalized: parsed.normalized, network: parsed.network, prefix })
  }

  parsedList.sort((a, b) => {
    if (a.network !== b.network) return a.network < b.network ? -1 : 1
    if (a.prefix !== b.prefix) return a.prefix - b.prefix
    return a.normalized.localeCompare(b.normalized)
  })

  return { ok: true, cidrs: parsedList.map((p) => p.normalized) }
}
