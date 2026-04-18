/**
 * Instagram のフォロワー一覧からコピーしたテキストからユーザー名を抽出する。
 *
 * - 行頭行末の「·」(U+00B7)「・」(U+30FB) を行から除去し、空になった行は捨てる。
 * - その後、基本的に「ユーザー名」「表示名」の交互とみなし、ユーザー名行だけを採用する。
 * - 「·」のみの行は除去後に空になるためスキップされ、結果として奇数行目＝ID に相当する。
 * - 「m_icsoftのプロフィール写真」の直後に ID だけ続く行がある場合は、先頭行を飛ばして ID を採用する。
 */

function normalizeUsername(s: string): string {
  return s.replace(/^@+/, '').trim().toLowerCase()
}

/** Instagram ユーザー名に近いパターン（手入力いいねユーザーと同程度） */
const IG_USERNAME_RE = /^[a-z0-9._]{1,30}$/

export function parseFollowerUsernamesFromPaste(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim())
  const cleaned: string[] = []
  for (const line of lines) {
    if (!line) continue
    const stripped = line.replace(/[\u00B7\u30FB]/g, '').trim()
    if (!stripped) continue
    cleaned.push(stripped)
  }

  const seen = new Set<string>()
  const out: string[] = []
  let i = 0
  while (i < cleaned.length) {
    const cur = normalizeUsername(cleaned[i])
    if (!IG_USERNAME_RE.test(cur)) {
      if (i + 1 < cleaned.length) {
        const nxt = normalizeUsername(cleaned[i + 1])
        if (IG_USERNAME_RE.test(nxt)) {
          if (!seen.has(nxt)) {
            seen.add(nxt)
            out.push(nxt)
          }
          i += 2
          continue
        }
      }
      i += 1
      continue
    }
    if (i + 1 < cleaned.length) {
      const nxt = normalizeUsername(cleaned[i + 1])
      if (IG_USERNAME_RE.test(nxt)) {
        if (!seen.has(cur)) {
          seen.add(cur)
          out.push(cur)
        }
        i += 1
        continue
      }
    }
    if (!seen.has(cur)) {
      seen.add(cur)
      out.push(cur)
    }
    i += 2
  }
  return out
}
