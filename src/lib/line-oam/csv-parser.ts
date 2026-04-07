// ============================================================
// LINE OAM CSV パーサー
// ============================================================

/** CSV 文字列をオブジェクト配列にパース（ダブルクォート対応） */
export function parseCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map(h => h.trim())
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()]))
  })
}

/** CSV 1 行をフィールド配列にパース */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

// ----------------------------------------------------------------
// 日付変換ヘルパー
// ----------------------------------------------------------------

/** "YYYYMMDD" → Date (JST 0:00) */
export function parseYYYYMMDD(s: string): Date {
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00+09:00`)
}

/** "YYYY-MM-DD" → Date (JST 0:00) */
export function parseYYYYMMDDDash(s: string): Date {
  return new Date(`${s}T00:00:00+09:00`)
}

/** Date → "YYYYMMDD" */
export function toYYYYMMDD(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Date → "YYYY-MM-DD" */
export function toYYYYMMDDDash(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

/** Date → UNIX ミリ秒（整数文字列） */
export function toUnixMs(d: Date): string {
  return String(d.getTime())
}

/** "YYYY/MM/DD HH:mm:ss" → ISO 8601 (JST) */
export function parseLineDateTime(s: string): string {
  const clean = s.replace(/^"|"$/g, '').trim()
  const [datePart, timePart] = clean.split(' ')
  return `${datePart.replace(/\//g, '-')}T${timePart}+09:00`
}

// ----------------------------------------------------------------
// URLテンプレート展開
// ----------------------------------------------------------------

export function buildUrl(
  template: string,
  vars: Record<string, string>
): string {
  return Object.entries(vars).reduce(
    (url, [k, v]) => url.replaceAll(`{${k}}`, v),
    template
  )
}
